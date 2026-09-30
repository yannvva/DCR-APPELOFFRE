'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert, ListChecks, Loader2, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { saveCompanyProfile } from '@/app/actions/company'
import { companyRequirements } from '@/lib/company'
import type { CompanyProfile } from '@/lib/company'
import { cn } from '@/lib/utils'

const linesToArr = (v: string) =>
  v
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
const arrToLines = (a?: string[]) => (a ?? []).join('\n')

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(required && !value.trim() && 'border-destructive/40')}
      />
    </div>
  )
}

export function CompanyProfileForm({
  orgSlug,
  initial,
  canEdit,
}: {
  orgSlug: string
  initial: CompanyProfile
  canEdit: boolean
}) {
  const [p, setP] = useState<CompanyProfile>(initial)
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()
  const requirements = useMemo(() => companyRequirements(p), [p])
  const reqDone = requirements.filter((r) => r.filled).length

  const getPath = (path: string): string => {
    const [section, field] = path.split('.')
    return (
      ((p as unknown as Record<string, Record<string, unknown>>)[section]?.[
        field
      ] as string) ?? ''
    )
  }
  const setPath = (path: string, value: string) => {
    const [section, field] = path.split('.')
    setP((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section as keyof CompanyProfile] as object),
        [field]: value,
      },
    }))
    setDirty(true)
  }

  const set = <
    K extends keyof CompanyProfile,
    F extends keyof NonNullable<CompanyProfile[K]>,
  >(
    section: K,
    field: F,
    value: string,
  ) => {
    setP((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as object), [field]: value },
    }))
    setDirty(true)
  }
  const setList = (
    key: 'certifications' | 'equipe' | 'implantations' | 'references',
    v: string,
  ) => {
    setP((prev) => ({ ...prev, [key]: linesToArr(v) }))
    setDirty(true)
  }
  const setFinanceCA = (v: string) => {
    setP((prev) => ({
      ...prev,
      finance: { ...prev.finance, chiffre_affaires: linesToArr(v) },
    }))
    setDirty(true)
  }
  const setAssurances = (v: string) => {
    setP((prev) => ({ ...prev, assurances: { lignes: linesToArr(v) } }))
    setDirty(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await saveCompanyProfile(orgSlug, p)
      if (res?.error) toast.error(res.error)
      else {
        setDirty(false)
        toast.success(
          'Profil société enregistré — les agents l’utiliseront pour les prochains documents',
        )
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Card id="elements">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="size-4" />
              Éléments demandés par les pièces
              <Badge variant={reqDone === requirements.length ? 'secondary' : 'outline'}>
                {reqDone}/{requirements.length}
              </Badge>
              {dirty && (
                <Badge variant="destructive" className="font-normal">
                  Non enregistré
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground text-xs">
              Ces informations sont demandées par les DC1/DC2, mémoires techniques
              et pièces générées. Renseignez les manquantes directement ici puis
              enregistrez — elles restent à jour pour toutes les opérations.
            </p>
            <ul className="divide-border divide-y">
              {requirements.map((r) => {
                const path = r.path
                return (
                <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                  {r.filled ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <CircleAlert className="size-4 shrink-0 text-amber-500" />
                  )}
                  <span className="w-52 shrink-0">{r.label}</span>
                  {r.filled ? (
                    // Valeur enregistrée — vérifiable sans défiler ;
                    // l'usage reste accessible en survol.
                    <span
                      className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
                      title={`${r.value ?? ''} — ${r.usage}`}
                    >
                      {r.value}
                    </span>
                  ) : (
                    <span className="flex-1 text-xs text-amber-600 dark:text-amber-400">
                      Manquant — {r.usage}
                    </span>
                  )}
                  {r.filled ? (
                    <a
                      href={`#${r.section}`}
                      className="text-muted-foreground/70 shrink-0 text-xs underline-offset-2 hover:text-primary hover:underline"
                      title={r.usage}
                    >
                      Modifier ↓
                    </a>
                  ) : path ? (
                    <Input
                      value={getPath(path)}
                      onChange={(e) => setPath(path, e.target.value)}
                      placeholder={r.label}
                      className="h-7 w-56 shrink-0 text-xs"
                    />
                  ) : (
                    <a
                      href={`#${r.section}`}
                      className="text-primary shrink-0 text-xs underline-offset-2 hover:underline"
                    >
                      Compléter ↓
                    </a>
                  )}
                </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <Card id="identite" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="text-base">Identité juridique</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Raison sociale"
              value={p.identite.raison_sociale ?? ''}
              onChange={(v) => set('identite', 'raison_sociale', v)}
              placeholder="DCR — Design Construction Rénovation"
              required
            />
            <Field
              label="Forme juridique"
              value={p.identite.forme_juridique ?? ''}
              onChange={(v) => set('identite', 'forme_juridique', v)}
              placeholder="SAS"
            />
            <Field
              label="Capital (€)"
              value={p.identite.capital_euros ?? ''}
              onChange={(v) => set('identite', 'capital_euros', v)}
            />
            <Field
              label="SIREN"
              value={p.identite.siren ?? ''}
              onChange={(v) => set('identite', 'siren', v)}
              required
            />
            <Field
              label="SIRET (siège)"
              value={p.identite.siret ?? ''}
              onChange={(v) => set('identite', 'siret', v)}
              required
            />
            <Field
              label="RCS (ville)"
              value={p.identite.rcs_ville ?? ''}
              onChange={(v) => set('identite', 'rcs_ville', v)}
              placeholder="Bobigny"
            />
            <Field
              label="Code APE"
              value={p.identite.code_ape ?? ''}
              onChange={(v) => set('identite', 'code_ape', v)}
              placeholder="4120A"
            />
            <Field
              label="TVA intracommunautaire"
              value={p.identite.tva_intracom ?? ''}
              onChange={(v) => set('identite', 'tva_intracom', v)}
            />
            <Field
              label="Date de création"
              value={p.identite.date_creation ?? ''}
              onChange={(v) => set('identite', 'date_creation', v)}
              placeholder="2016"
            />
          </CardContent>
        </Card>

        <Card id="contact" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              Siège, contact et représentant
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <Field
                label="Adresse du siège"
                value={p.siege.adresse ?? ''}
                onChange={(v) => set('siege', 'adresse', v)}
                placeholder="n° rue — CP Ville"
                required
              />
            </div>
            <Field
              label="Téléphone"
              value={p.siege.telephone ?? ''}
              onChange={(v) => set('siege', 'telephone', v)}
            />
            <Field
              label="Email"
              value={p.siege.email ?? ''}
              onChange={(v) => set('siege', 'email', v)}
            />
            <Field
              label="Site web"
              value={p.siege.site_web ?? ''}
              onChange={(v) => set('siege', 'site_web', v)}
            />
            <Field
              label="Dirigeant / signataire"
              value={p.dirigeant.nom ?? ''}
              onChange={(v) => set('dirigeant', 'nom', v)}
              placeholder="Nom Prénom"
              required
            />
            <Field
              label="Qualité (DC1, AE)"
              value={p.dirigeant.qualite ?? ''}
              onChange={(v) => set('dirigeant', 'qualite', v)}
              placeholder="Président, Gérant…"
            />
          </CardContent>
        </Card>

        <Card id="banque" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="text-base">Banque et finances</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Titulaire du compte (RIB)"
              value={p.banque.titulaire ?? ''}
              onChange={(v) => set('banque', 'titulaire', v)}
            />
            <Field
              label="Domiciliation bancaire"
              value={p.banque.domiciliation ?? ''}
              onChange={(v) => set('banque', 'domiciliation', v)}
            />
            <Field
              label="IBAN"
              value={p.banque.iban ?? ''}
              onChange={(v) => set('banque', 'iban', v)}
              required
            />
            <Field
              label="BIC"
              value={p.banque.bic ?? ''}
              onChange={(v) => set('banque', 'bic', v)}
            />
            <Field
              label="Effectif"
              value={p.finance.effectif ?? ''}
              onChange={(v) => set('finance', 'effectif', v)}
              placeholder="25"
              required
            />
            <Field
              label="Notation Banque de France"
              value={p.finance.notation_bdf ?? ''}
              onChange={(v) => set('finance', 'notation_bdf', v)}
              placeholder="G4"
            />
            <Field
              label="Agences de notation"
              value={p.finance.agences_notation ?? ''}
              onChange={(v) => set('finance', 'agences_notation', v)}
              placeholder="Euler Hermes, Coface"
            />
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-muted-foreground text-xs">
                Chiffre d’affaires — une ligne par exercice
              </Label>
              <Textarea
                rows={2}
                value={arrToLines(p.finance.chiffre_affaires)}
                onChange={(e) => setFinanceCA(e.target.value)}
                placeholder={'2025 — 14 M€\n2024 — 12 M€'}
              />
            </div>
          </CardContent>
        </Card>

        <Card id="assurances" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              Assurances et certifications
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Assurances — une ligne par police (décennale, RC pro…)
              </Label>
              <Textarea
                rows={3}
                value={arrToLines(p.assurances.lignes)}
                onChange={(e) => setAssurances(e.target.value)}
                placeholder={
                  'Décennale — Assureur — police n°… — échéance\nRC professionnelle — …'
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Certifications — une par ligne (Qualibat, amiante SS4, ISO…)
              </Label>
              <Textarea
                rows={3}
                value={arrToLines(p.certifications)}
                onChange={(e) => setList('certifications', e.target.value)}
                placeholder={'Qualibat — …\nCertification amiante SS4'}
              />
            </div>
          </CardContent>
        </Card>

        <Card id="equipe" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              Équipe, implantations et références
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Équipe clé — « Nom — fonction — expérience » (mémoire §3)
              </Label>
              <Textarea
                rows={5}
                value={arrToLines(p.equipe)}
                onChange={(e) => setList('equipe', e.target.value)}
                placeholder={
                  'YILDIRIM Mathieu — Directeur travaux — 18 ans\nSELCUK Selami — Chef de chantier TCE — 20 ans'
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Implantations — « Entrepôt 1 000 m² — Île-de-France »
              </Label>
              <Textarea
                rows={5}
                value={arrToLines(p.implantations)}
                onChange={(e) => setList('implantations', e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-muted-foreground text-xs">
                Références chantier — « Opération — MOA — année / montant »
              </Label>
              <Textarea
                rows={4}
                value={arrToLines(p.references)}
                onChange={(e) => setList('references', e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-muted-foreground text-xs">
                Présentation de l’entreprise — texte repris par les agents
                (mémoire §1, plaquettes)
              </Label>
              <Textarea
                rows={5}
                value={p.presentation ?? ''}
                onChange={(e) => {
                  setP((prev) => ({ ...prev, presentation: e.target.value }))
                  setDirty(true)
                }}
              />
            </div>
          </CardContent>
        </Card>
      </fieldset>

      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Enregistrer le profil
          </Button>
        </div>
      )}
    </form>
  )
}
