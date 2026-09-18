# Verifying the tanker_activity migration

Run these **after** you've pasted `0001_tanker_activity.sql` into the Supabase
SQL Editor and run it. PowerShell, run from the repo root (`C:\Users\Natan\gridmonitor`,
where `.env` lives). None of these commands print the key values themselves —
each reads `.env` into a local variable and uses it only inside the `curl.exe`
call.

```powershell
$envLines = Get-Content .env
$url = ($envLines | Where-Object { $_ -match '^SUPABASE_URL=' }) -replace '^SUPABASE_URL=', ''
$publishable = ($envLines | Where-Object { $_ -match '^SUPABASE_PUBLISHABLE_KEY=' }) -replace '^SUPABASE_PUBLISHABLE_KEY=', ''
$secret = ($envLines | Where-Object { $_ -match '^SUPABASE_SECRET_KEY=' }) -replace '^SUPABASE_SECRET_KEY=', ''
```

## 1. Publishable key can read terminal_snapshot

```powershell
curl.exe -s -o - -w "`nHTTP %{http_code}`n" "$url/rest/v1/terminal_snapshot?select=*" `
  -H "apikey: $publishable" `
  -H "Authorization: Bearer $publishable"
```
Expect **HTTP 200** and a JSON array — `[]` is correct if the worker hasn't
written a snapshot yet.

## 2. Publishable key is rejected on insert

```powershell
curl.exe -s -o - -w "`nHTTP %{http_code}`n" -X POST "$url/rest/v1/terminal_snapshot" `
  -H "apikey: $publishable" `
  -H "Authorization: Bearer $publishable" `
  -H "Content-Type: application/json" `
  -d '{"terminal_id":"verify_test","docked_count":0,"stale_count":0}'
```
Expect **HTTP 401 or 403**, with a body mentioning row-level security (exact
code depends on your PostgREST version — either is correct here; a 200/201
means the RLS policy isn't doing its job).

## 3. Secret key can insert

```powershell
curl.exe -s -o - -w "`nHTTP %{http_code}`n" -X POST "$url/rest/v1/terminal_snapshot" `
  -H "apikey: $secret" `
  -H "Authorization: Bearer $secret" `
  -H "Content-Type: application/json" `
  -H "Prefer: return=representation" `
  -d '{"terminal_id":"verify_test","docked_count":0,"stale_count":0}'
```
Expect **HTTP 201** and the inserted row echoed back.

## 4. Clean up the test row

`verify_test` isn't a real terminal (the launch set is `rotterdam`, `houston`,
`corpus_christi`) — delete it so it doesn't show up anywhere:

```powershell
curl.exe -s -o - -w "`nHTTP %{http_code}`n" -X DELETE "$url/rest/v1/terminal_snapshot?terminal_id=eq.verify_test" `
  -H "apikey: $secret" `
  -H "Authorization: Bearer $secret"
```
Expect **HTTP 204**.
