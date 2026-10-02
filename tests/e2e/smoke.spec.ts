import { expect, test } from '@playwright/test'

/**
 * Tests de fumée : les parcours d'entrée non authentifiés doivent rester
 * accessibles et la protection des routes doit rediriger vers /login.
 * Aucun compte de test requis.
 */

test('la page de connexion s’affiche avec le lien mot de passe oublié', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Connexion', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Mot de passe')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mot de passe oublié ?' })).toBeVisible()
})

test('la demande de réinitialisation est accessible sans compte', async ({ page }) => {
  await page.goto('/mot-de-passe-oublie')
  await expect(
    page.getByRole('button', { name: 'Envoyer le lien de réinitialisation' }),
  ).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
})

test('la page de création de compte expose le formulaire complet', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByLabel('Nom complet')).toBeVisible()
  await expect(page.getByLabel('Mot de passe')).toBeVisible()
})

test('une route protégée redirige un visiteur vers /login avec next', async ({ page }) => {
  await page.goto('/dcr/dashboard')
  await expect(page).toHaveURL(/\/login\?next=/)
})

test('les pages légales sont publiques', async ({ page }) => {
  await page.goto('/mentions-legales')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.goto('/confidentialite')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
