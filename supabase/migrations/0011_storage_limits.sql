-- ============================================================================
-- 0011 — Limites du bucket documents
--
-- Les DCE réels dépassent régulièrement 25 Mo (PDF scannés, plans) et
-- contiennent des formats hors whitelist (.rar, .doc, .octet-stream, DWG…) :
-- les uploads étaient rejetés silencieusement (« échec upload »).
-- → Plafond porté à 200 Mo, whitelist de types levée (le bucket reste privé,
--    l'accès est gouverné par les policies storage.objects par préfixe org_).
-- ============================================================================

update storage.buckets
set file_size_limit = 209715200,
    allowed_mime_types = null
where id = 'documents';
