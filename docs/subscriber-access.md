# Subscriber access release

## Diagnosis on 14 September 2026

Four production invitations created today were confirmed after approximately 14,
18, 24 and 26 seconds. This rules out a one-hour timeout as the explanation for
those first confirmations. It does not identify who opened the links: mail
security software and real recipient clicks both fit these timestamps.

The old confirmation handler consumed token hashes on GET. Supabase documents
that mail prefetch can consume single-use links. The handler also required a
token hash in the query string: the default Supabase ConfirmationURL returns a
session in a browser fragment, which the handler cannot read. The production
email templates and the reported Vercel error log were not available for
verification in this investigation.

Creating a subscriber also previously re-used inviteUserByEmail for an existing
identity and threw provider errors into the page. The new recovery action sends
a password link without creating an account. New provisioning first reserves a
new auth user, so duplicate invitations cannot enter rollback and delete an
existing identity.

## Release order

1. Apply `202609140001_preserve_data_on_user_deletion.sql`. This keeps existing
   decisions and export workbooks when a login is deleted. Only their author
   reference becomes null; deleting the auth user removes its membership in the
   same database operation. Account and hotel rows remain.
2. Deploy the app changes to Vercel.
3. In the hosted Supabase project's Authentication email templates, replace
   **Invite user** and **Reset password** with `supabase/templates/invite.html`
   and `supabase/templates/recovery.html`. Local config does not update hosted
   templates automatically. Both must point directly to the application's
   `/auth/confirm` with TokenHash, never via ConfirmationURL.
4. Verify Supabase Site URL and Vercel NEXT_PUBLIC_SITE_URL both use the real
   production origin. Keep the app's redirect URL allowed in Supabase.
5. Send a fresh invitation to an explicitly approved test mailbox. Previously
   consumed links cannot be repaired. Opening the link repeatedly must show the
   password form without confirming the user. Only submitting a valid matching
   password may confirm the token and establish the session. Test in Outlook
   and in a different browser from the administrator's browser.
6. Request a new password link for a confirmed user and an unconfirmed invitee.
   Both must be able to choose a password. Verify duplicate creation and email
   rate limits show a readable message instead of a server error page.
7. For an approved disposable login, verify deletion removes access while
   retaining hotels, decisions and downloadable export history in the database.
   Once its last login is removed, the account row must disappear from Abonnees.
   The retained account is no longer shown with a replacement-email form.

The password form verifies the token only after password validation, on POST.
This protects against link scanners that perform GET requests; it is not a
claim that arbitrary automation cannot submit a form. Referrer policy prevents
the password-link token being sent as a referrer to other sites. Links remain
single-use and retain the project's configured email expiry; JWT expiry is a
different setting and is not changed here.

Only platform administrators can manage these logins. Actions verify membership
on the server, reject administrator/self deletion, and get recovery email
addresses from the authentication service rather than trusting the form.

## Local verification

- 23 focused tests passed for email-link opening, password submission,
  administrator authorization, recovery, duplicate creation and login deletion.
- 10 PostgreSQL checks passed against the isolated local live-refresh database:
  retained account/hotel/decision/workbook/snapshot, cleared author references,
  revoked membership access and replacement-login access. Test data rolled back.
- Real local Supabase accepted createUser followed by inviteUserByEmail, rejected
  duplicate creation without changing the original identity, and accepted a
  recovery request for an unconfirmed user. Both invite and recovery token
  verification followed by password update and password login succeeded.
  Disposable local auth fixtures were removed.
- Type checking, lint on changed app directories and the production build passed.
- No production users, email templates, database schema or deployments changed.

The simplification pass kept the existing account/membership model and native
Supabase emails. There is no new signup flow, custom token storage or retry
system. Removing the two foreign-key changes would block deletion for users with
saved decisions or exports; removing new-identity reservation would reintroduce
the risk of provisioning rollback deleting an existing unconfirmed login.

References:
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/managing-user-data
