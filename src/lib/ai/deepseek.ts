import 'server-only'

import { getEnv } from '@/env'
import { webFetch, webSearch } from './web-tools'

const API_URL = 'https://api.deepseek.com/chat/completions'
const TIMEOUT_MS = 240_000

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmResult {
  text: string
  model: string
  usage: LlmUsage
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
  tool_call_id?: string
}

interface ChatResponse {
  model?: string
  choices?: {
    finish_reason?: string
    message?: ChatMessage
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function requireKey(): { key: string; model: string } {
  const env = getEnv()
  if (!env.DEEPSEEK_API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local pour activer l’analyse IA.',
    )
  }
  return { key: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL }
}

// deepseek-chat : sortie max 8 192 tokens — on borne pour éviter un HTTP 400.
const MAX_OUTPUT_TOKENS = 8192

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function callApi(
  body: Record<string, unknown>,
): Promise<ChatResponse> {
  const { key, model } = requireKey()
  if (typeof body.max_tokens === 'number') {
    body = { ...body, max_tokens: Math.min(body.max_tokens, MAX_OUTPUT_TOKENS) }
  }
  // Un retry unique sur les erreurs transitoires (429, 5xx, coupure réseau,
  // timeout) — les agents de recherche enchaînent des dizaines d'appels et
  // un seul échec transitoire ne doit pas perdre tout le run.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, ...body }),
      })
    } catch (e) {
      if (attempt === 0) {
        await sleep(2_000)
        continue
      }
      throw e instanceof Error ? e : new Error('Échec réseau DeepSeek.')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        await sleep(2_000)
        continue
      }
      throw new Error(`DeepSeek HTTP ${res.status} : ${text.slice(0, 300)}`)
    }
    return (await res.json()) as ChatResponse
  }
  throw new Error('DeepSeek injoignable.')
}

function extractJson<T>(text: string, model: string, usage: LlmUsage) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Réponse IA non-JSON.')
  try {
    return { data: JSON.parse(cleaned.slice(start, end + 1)) as T, model, usage }
  } catch {
    throw new Error('JSON IA invalide (tronqué ou malformé).')
  }
}

/** Appel unique à l'API DeepSeek (compatible OpenAI). Lève une Error explicite. */
export async function complete(opts: {
  system: string
  prompt: string
  maxTokens?: number
  json?: boolean
}): Promise<LlmResult> {
  const data = await callApi({
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.prompt },
    ],
    max_tokens: opts.maxTokens ?? 8192,
    temperature: 0.1,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  })
  const msg = data.choices?.[0]?.message
  const text = (msg?.content ?? '').trim()
  if (!text) throw new Error('Réponse IA vide.')
  return {
    text,
    model: data.model ?? 'deepseek',
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  }
}

/** Appel LLM attendu en JSON strict (response_format json_object + tolérance fences). */
export async function completeJson<T>(opts: {
  system: string
  prompt: string
  maxTokens?: number
}): Promise<{ data: T } & Omit<LlmResult, 'text'>> {
  const r = await complete({ ...opts, json: true })
  try {
    return extractJson<T>(r.text, r.model, r.usage)
  } catch {
    // Sortie tronquée (plafond 8 192 tokens) ou malformée : un second essai
    // en demandant une sortie compacte. Le coût d'un appel de plus est bien
    // moindre que celui d'un run perdu (analyse DCE, dépouillage…).
    const retry = await complete({
      system: `${opts.system}\nRéponds avec un JSON COMPACT : chaînes courtes, aucun champ superflu.`,
      prompt: opts.prompt,
      maxTokens: opts.maxTokens,
      json: true,
    })
    const parsed = extractJson<T>(retry.text, retry.model, {
      inputTokens: r.usage.inputTokens + retry.usage.inputTokens,
      outputTokens: r.usage.outputTokens + retry.usage.outputTokens,
    })
    return parsed
  }
}

// ============================ AGENT DE RECHERCHE WEB ============================

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Recherche web (DuckDuckGo). Retourne titre + url + extrait pour chaque résultat.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Requête de recherche' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Ouvre une URL et retourne son contenu texte (HTML nettoyé ou texte extrait du PDF).',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL à ouvrir' } },
        required: ['url'],
      },
    },
  },
]

async function runTool(name: string, argsJson: string): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return 'Erreur : arguments JSON invalides.'
  }
  try {
    if (name === 'web_search') return await webSearch(String(args.query ?? ''))
    if (name === 'web_fetch') return await webFetch(String(args.url ?? ''))
    return `Outil inconnu : ${name}`
  } catch (e) {
    return `Erreur outil ${name} : ${e instanceof Error ? e.message : 'inconnue'}`
  }
}

/**
 * Agent de recherche : boucle function-calling DeepSeek avec web_search +
 * web_fetch exécutés localement, jusqu'à la réponse JSON finale.
 */
export async function completeResearchJson<T>(opts: {
  system: string
  prompt: string
  maxTokens?: number
  maxTurns?: number
  maxSearches?: number
  maxFetches?: number
}): Promise<{ data: T } & Omit<LlmResult, 'text'>> {
  const usage = { inputTokens: 0, outputTokens: 0 }
  const counts = { search: 0, fetch: 0 }
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ]
  const maxTurns = opts.maxTurns ?? 18
  const maxSearches = opts.maxSearches ?? 12
  const maxFetches = opts.maxFetches ?? 20

  // Recherche web indisponible (moteurs limités/bloqués) : insister brûle des
  // dizaines de milliers de tokens pour rien — on arrête et on rédige.
  let deadSearchStreak = 0
  let searchUnavailable = false

  for (let turn = 0; turn < maxTurns; turn++) {
    // Fin de budget (tours ou quotas) : on RETIRE les outils pour que le
    // modèle soit obligé de rédiger le JSON final. Sans ça, un agent qui
    // enchaîne les recherches jusqu'au dernier tour levait une erreur et
    // TOUT le travail de recherche était perdu.
    const forceFinal =
      searchUnavailable ||
      turn >= maxTurns - 2 ||
      (counts.search >= maxSearches && counts.fetch >= maxFetches)
    const data = await callApi({
      messages,
      ...(forceFinal ? {} : { tools: TOOLS }),
      max_tokens: opts.maxTokens ?? 8192,
      temperature: 0.1,
    })
    usage.inputTokens += data.usage?.prompt_tokens ?? 0
    usage.outputTokens += data.usage?.completion_tokens ?? 0
    const model = data.model ?? 'deepseek'
    const msg = data.choices?.[0]?.message
    if (!msg) throw new Error('Réponse IA vide.')

    if (msg.tool_calls?.length) {
      messages.push(msg)
      if (forceFinal) {
        messages.push({
          role: 'user',
          content:
            'Plus d’outils disponibles. Rédige MAINTENANT le JSON final complet avec les informations déjà collectées (sans markdown).',
        })
        continue
      }
      // Attribution des quotas EN PREMIER (séquentiel), exécution des outils
      // EN PARALLÈLE ensuite : le modèle émet souvent 2-4 tool_calls
      // indépendants par tour — en série, chaque recherche attendait la
      // précédente. Les réponses sont repoussées dans l'ordre des appels.
      const plan = msg.tool_calls.map((call) => {
        if (call.function.name === 'web_search' && counts.search >= maxSearches)
          return { call, quota: 'recherches' }
        if (call.function.name === 'web_fetch' && counts.fetch >= maxFetches)
          return { call, quota: 'lectures' }
        if (call.function.name === 'web_search') counts.search++
        if (call.function.name === 'web_fetch') counts.fetch++
        return { call, quota: null as string | null }
      })
      const contents = await Promise.all(
        plan.map((p) =>
          p.quota ? Promise.resolve(null) : runTool(p.call.function.name, p.call.function.arguments),
        ),
      )
      for (let j = 0; j < plan.length; j++) {
        const { call, quota } = plan[j]
        const content =
          quota != null
            ? `Quota de ${quota} atteint — rédige le JSON final avec ce que tu as.`
            : (contents[j] ?? 'Erreur : outil sans réponse.')
        // CHAQUE tool_call DOIT recevoir sa réponse « tool » — avant, la
        // sortie « recherche indisponible » sautait ce push et l'appel
        // suivant envoyait un tool_call sans réponse (HTTP 400, run perdu).
        messages.push({ role: 'tool', tool_call_id: call.id, content })
        if (call.function.name === 'web_search' && quota == null) {
          deadSearchStreak = /aucun résultat|too many requests|indisponible/i.test(
            content,
          )
            ? deadSearchStreak + 1
            : 0
          if (deadSearchStreak >= 4 && !searchUnavailable) {
            searchUnavailable = true
            messages.push({
              role: 'user',
              content:
                'La recherche web est indisponible (moteurs limités ou bloqués). N’insiste plus : rédige MAINTENANT le JSON final à partir des exigences du CCTP, avec le statut « à obtenir » pour les documents non vérifiables. N’invente aucune marque ni URL.',
            })
          }
        }
        if (process.env.AGENT_TRACE) {
          console.log(
            `[trace ${call.function.name}] ${String(call.function.arguments).slice(0, 160)} → ${content.slice(0, 160).replace(/\n/g, ' ')}`,
          )
        }
      }
      continue
    }

    const text = (msg.content ?? '').trim()
    if (!text) {
      messages.push({
        role: 'user',
        content: 'Renvoie le JSON final demandé, rien d’autre.',
      })
      continue
    }
    try {
      return extractJson<T>(text, model, usage)
    } catch (e) {
      // Sortie tronquée ou bavarde : une chance de corriger
      if (turn === maxTurns - 1) throw e
      messages.push({ role: 'assistant', content: msg.content })
      messages.push({
        role: 'user',
        content:
          'Ta réponse n’était pas un JSON valide et complet. Renvoie UNIQUEMENT le JSON final complet (sans markdown).',
      })
    }
  }
  throw new Error('Agent de recherche interrompu sans résultat.')
}
