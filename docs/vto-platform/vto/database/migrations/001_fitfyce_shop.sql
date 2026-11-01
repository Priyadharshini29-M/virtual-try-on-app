-- Button / icon design now comes from the FitFyce app (Widget Settings), not the VTO admin.
-- Each VTO site points at the FitFyce merchant whose settings it uses.
USE vto_platform;
ALTER TABLE sites
  ADD COLUMN fitfyce_shop VARCHAR(190) NULL COMMENT 'FitFyce merchant shop domain, e.g. store.myshopify.com' AFTER start_url;
