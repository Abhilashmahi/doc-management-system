# e-Sevai Document Manager

A web app for managing, editing, storing and exporting e-Sevai-style documents.

**Current status: Phase 2.** This version includes:

- **Sign-in and accounts:** secure sign-in (Argon2id, server-side sessions, HttpOnly cookies, rate limiting, lockout), self sign-up (can be switched off in Settings), Google sign-in (optional), and changing your own password.
- **Dashboard:** live counts from SQL Server, documents by category, documents per month, recently edited and opened documents, and recent activity.
- **Documents:**
  - Upload PDF, DOCX, XLSX, CSV, TXT, PNG or JPEG files, or create documents from templates.
  - Search, filter, folders, rename, move, duplicate, archive, restore and delete.
  - Version history; uploaded originals are never overwritten.
  - Preview of PDF, image, text and CSV files.
- **Template designer (Canva-style):**
  - Text, shapes, lines, images, dynamic fields (`{{FullName}}`), Code 128 barcodes and QR codes (fixed value or bound to a field), and page backgrounds (including a scanned form image).
  - Layers, lock, group, align, undo/redo, copy/paste, keyboard shortcuts, zoom, rulers, snapping guides, multiple pages, autosave, and template version history.
- **Fill-in forms:** a form generated from the template's fields, with validation and a live preview. Save as draft, save, or "save & add another".
- **Export:** PDF, PNG and JPEG export of designed documents, made in the browser.
- **Administration:** offices (Master Admin), users and roles, categories, Field Master, application settings, and a full activity log with retention.

**Not built yet:**
- Password reset by email, and email OTP/MFA. Both need an email provider.
- Editable overlays on uploaded PDFs.
- Converting DOCX/XLSX into editable templates.
- OpenAPI/Swagger docs.

### Writer (in the style of WPS Writer / Word)

**Writer** in the sidebar (or **Edit in Writer** on a Word, PDF, text or HTML document) opens a word processor.

- **Ribbon:**
  - **Home:** paste, cut, copy, format painter, font, size, bold/italic/underline/strike, superscript/subscript, highlight and font colour, change case, clear formatting, bullets, numbering, indent, alignment, line and paragraph spacing, styles (Normal, Heading 1–3), find & replace.
  - **Insert:** tables (with row/column, merge and shading tools), pictures, page breaks, lines, links, the date and symbols.
  - **Page Layout:** margins, orientation, page size and paragraph indents.
  - **Review:** word count, spelling, and Tamil fixing.
  - **View:** zoom.
- **Tamil:** many old Tamil PDFs and Word files use the **Bamini** font (also Sun-Tommy). They store Tamil as English keys, so copying gives gibberish such as `mDg;Geh;` instead of அனுப்புநர். The Writer turns this into real Unicode Tamil when it opens a file and when you paste. **Fix Tamil** converts any text that was missed.
- **Typing Tamil:** choose a keyboard in the Tamil group, or press **Alt+T** to switch between English and Tamil.
  - **Phonetic:** type Tamil in English letters: `ammaa` → அம்மா, `vaNakkam` → வணக்கம், `thamizh` → தமிழ்.
  - **Bamini:** the old typewriter layout: `mDg;Geh;` → அனுப்புநர்.
  - **Tamil99:** the Tamil Nadu Government standard layout.
  - **Tamil letters** opens a panel of letters to click, with a reminder of the keys. Backspace removes the last key you typed.
- **Fonts:** the font box works like WPS: search, recently used fonts, Tamil fonts, fonts added to the website, and the fonts on this computer (**Show all** lists every one). Each font is shown in its own style.
  - **Add font** (administrators): add a .ttf, .otf, .woff or .woff2 file (for example Bamini, Latha or Isvariya). Everyone's Writer can then use it without installing it.
  - Choose **Old Tamil font** for Bamini-style fonts, which draw Tamil over English keys. Text stays real Tamil on screen and when copied; printing, PDF and Word files write it as Bamini keys in that font, so it looks like the font. (Word shows it correctly only where that font is installed.)
- **Opening a PDF:** indents, centred lines, font sizes and blank lines are kept. Columns, pictures and drawn boxes in the PDF are not.
- **Save:** an opened .docx gets a new version. Anything else is saved as a new Word document, and the original is kept.
- **File menu:** download as Word, PDF, HTML or text, and print. **Download as PDF** makes the PDF on the server with Edge or Chrome (no printer or print window needed); set `PDF_BROWSER_PATH` in `backend.env` if neither is in its usual place. **Save as new document** can save a Word file or a PDF into Documents.

The server's **PDF → Word** and **PDF → Text** conversions also fix Bamini Tamil now.

### Paint

**Paint** in the sidebar (or on the dashboard) opens a drawing program in the style of Windows Paint.

**Tools:**
- **Drawing:** pencil, four brushes (brush, calligraphy pen, airbrush, marker), eraser, paint bucket, colour picker, text (any font, size, bold/italic/underline; Tamil works with Nirmala UI) and magnifier.
- **Shapes:** 19 shapes with outline and fill. Hold Shift for a perfect square or circle, or a straight 45° line.
- **Selection:** select, move, cut, copy, paste (including pictures copied from other programs), delete and crop.
- **Picture:** rotate, flip, resize (stretch, or change only the drawing area), and drag the edge handles to change the size.
- **Undo and zoom:** undo/redo (30 steps), zoom 12%–800% (Ctrl + mouse wheel).

Colour 1 draws with the left mouse button and colour 2 with the right, as in Paint.

**Saving:**
- **Save** puts the picture into Documents as PNG or JPEG. Choose a name and folder the first time; after that, each Save adds a new version.
- Any picture document (PNG, JPEG, GIF, BMP, WebP) has an **Edit in Paint** button. Saving it adds a new version, and the original stays in the version history.
- **File → Download** saves it to the computer without putting it in Documents.

### Sharing by WhatsApp, Gmail or link

Open a document and click **Share**.

- **WhatsApp**
  - **Share file to WhatsApp** sends the file itself through the device's share menu. It works on phones, and on Windows when the WhatsApp app is installed.
  - **Open WhatsApp** opens a chat with your message already typed (add a number, or pick the person in WhatsApp) and downloads the file so you can attach it. WhatsApp has no free way for a website to send files by itself.
  - Editors can tick **Put a download link in the message** so there is nothing to attach.
- **Gmail**
  - When an administrator has connected a Gmail account, **Send with file attached** e-mails the document straight from the app.
  - Otherwise **Open in Gmail** starts a new message with the details filled in and downloads the file to attach.
- **Link** (editors and admins): a secret download link that works for 1–30 days, with a download count and a **Turn off** button. Nobody needs to sign in to use it.

Designed documents are shared as the same PDF that **Export** makes. Every share is recorded in the activity log.

**Connect a Gmail account for one-click sending:**
1. Turn on 2-Step Verification for the Google account.
2. Create an App Password at https://myaccount.google.com/apppasswords.
3. Add `SMTP_USER=yourcentre@gmail.com` and `SMTP_PASSWORD=<the 16-letter app password>` to `backend\.env` (optionally `SMTP_FROM_NAME`).
4. Restart the backend.

Gmail allows attachments up to 25 MB and about 500 e-mails a day on a free account.

**Share links outside this computer:** links start with `PUBLIC_URL` (default `http://localhost:5173`), which only works on this PC. Once the app is published on the internet, set `PUBLIC_URL` to its address in `backend\.env`.

### Deleting documents (Trash)

- **Delete** (on a document's page, on each list row, or for several ticked documents at once) moves documents to **Documents → Trash**. Editors and administrators can delete and restore.
- **Delete forever** and **Empty trash** are for administrators. They also remove the file from the server's disk. A file that a duplicated copy still uses is kept until that copy is deleted forever too.
- Documents left in the Trash for **30 days** are deleted forever automatically (setting `trash_retention_days`, checked once a day).
- The activity log keeps a record of every delete, restore and permanent delete.

### PDF Tools (in the style of iLovePDF)

**PDF Tools** in the sidebar has one page per tool. On each one you select files (or drop them), check the files and set options, then press the big button. The result can be **downloaded** or **saved to Documents**.

| Group | Tools |
|---|---|
| Organize | Merge, Split (every page, page ranges, or every N pages), Remove pages, Organize (drag to reorder, rotate or delete pages), Rotate |
| Optimize | Compress (**Basic**: looks identical; **Strong**: pages become pictures, so text can no longer be selected) |
| Convert to PDF | JPG to PDF, Word, Excel, PowerPoint\*, Text and HTML\* to PDF, and "Convert any file" |
| Convert from PDF | PDF to JPG, PDF to PNG, PDF to Word (text only), PDF to Text |
| Edit | Add page numbers, Add watermark (Tamil works too), PDF to editable template (administrators) |

\* These tools need LibreOffice, as explained below.

**How your files are handled:**
- Files uploaded to a tool are processed in memory and not stored.
- A result can be downloaded for 30 minutes, and only by the person who made it.
- Nothing is sent to an outside website.

**Not included:** password protection and unlocking of PDFs. The PDF library used here cannot encrypt files, so these tools are left out rather than offered and failing.

### Canva-style design

- The home page opens with a "What will you create today?" banner.
- Round quick-start buttons cover Certificate, Landscape, ID card, Letter, From a PDF, New document, Upload and PDF tools. Administrators get a new template of the right size straight away.
- A strip of ready templates follows.
- The designer has a Canva-like gradient top bar and a dark tool rail.

### File types and conversion

**Accepted files:** an administrator chooses them in **Settings**. The app knows PDF, Word (DOCX, DOC, ODT, RTF), Excel (XLSX, XLS, ODS, CSV), PowerPoint (PPTX, PPT, ODP), text (TXT, MD, JSON, XML), web pages (HTML), images (PNG, JPEG, WebP, GIF, BMP, TIFF, SVG) and ZIP.
- "Also allow any other file type" accepts everything else as **download-only** files.
- Programs and scripts (.exe, .bat, .ps1, .js and similar) are always refused.
- The content of every known type is checked, so a renamed file is caught.

**Convert:** opens from an uploaded document's page. The converted copy is saved as a **new document**, and the original is never changed. Each option shows how faithful it is: **Exact**, **Good** or **Text only**.

| From | To (built in, works now) | Extra with LibreOffice |
|---|---|---|
| PNG, JPEG, WebP, GIF, TIFF, SVG | PNG, JPEG, WebP, PDF | — |
| PDF | PNG / JPEG (one image per page, ZIP for several pages), Word (text only), TXT | — |
| Word (DOCX) | HTML, TXT, PDF (headings and paragraphs only) | **exact PDF**, ODT |
| DOC, ODT, RTF | — | PDF, DOCX, TXT |
| Excel (XLSX) | CSV (ZIP for several sheets), JSON, PDF (plain table) | **exact PDF**, ODS |
| XLS, ODS | — | XLSX, PDF, CSV |
| CSV | Excel, PDF table, JSON | — |
| JSON (list of objects) | CSV, Excel | — |
| TXT, Markdown | PDF, Word | — |
| PowerPoint (PPTX, PPT, ODP) | — | PDF |
| HTML | TXT | PDF, DOCX |

**How the built-in conversions work:**
- PDFs are made with Noto Sans and Noto Sans Tamil fonts (in `backend\assets\fonts`, under the SIL Open Font License), so Tamil text prints correctly.
- CSV files are written so Excel opens Tamil text correctly. Values that look like formulas are made harmless.

**Not possible (and why):**
- **PDF → editable Word with the same layout:** a PDF stores positioned text, not paragraphs, so only the words can be recovered.
- **Scanned PDFs → text:** this needs OCR, which is not included.
- **Converting files of unknown types:** the app can't understand them, so it only stores them.

**LibreOffice (optional, free):** install it from libreoffice.org on the server PC. The app finds it in `C:\Program Files\LibreOffice` by itself, within a minute, with no restart. If it is installed somewhere else, set `SOFFICE_PATH` in `.env`.
- It gives exact Word/Excel/PowerPoint → PDF conversions.
- The app does not drive Microsoft Word for this, because Microsoft does not support Office automation on servers. It can freeze on pop-up dialogs.

### Known limitations (honest notes)

- **Exported PDFs:** each page is a high-resolution picture (about 192 DPI), so its text cannot be selected or searched.
- **Word and Excel files:** they are stored and downloadable but are not previewed, because converting them in the browser could change their layout.
- **PDF forms as templates:** to use a PDF form as a template, save its page as a PNG/JPEG and use it as the template's background.

### Roles

| Role | Can do |
|---|---|
| Master Admin | Everything, in every office. Picks the office to work on in the top bar. |
| Admin | Manages their own office: users, categories, fields, templates, and all documents. |
| Editor | Creates, edits, uploads and archives documents. |
| Viewer | Reads and downloads only. |

---

## 1. What you need installed

| Tool | Why | Check it |
|---|---|---|
| Node.js 22 or newer (LTS) | Runs the backend and frontend | `node -v` |
| SQL Server Express (already installed on your PC) | The database | Open SSMS and connect to `ABHILASH\SQLEXPRESS` |
| Git (optional) | Version control | `git --version` |

---

## 2. Folder layout

```
Doc control management/
├── backend/          Express API + SQL Server code
│   ├── src/
│   │   ├── config/       Reads settings from .env
│   │   ├── db/           Connection, create-database, migrations, seed
│   │   │   └── migrations/   Numbered SQL files (001_..., 002_...)
│   │   ├── middleware/   Login check, role check, CSRF origin check, errors
│   │   ├── routes/       /api/health and /api/auth
│   │   └── services/     Passwords, sessions, audit log
│   └── .env.example  Template for your private settings
├── frontend/         React + Vite + Tailwind screens
└── README.md         This file
```

---

## 3. First-time setup (step by step)

### Step 1: Make your private settings file

```powershell
cd "D:\Doc control management\backend"
copy .env.example .env
```

Open `backend\.env` in Notepad or VS Code. Replace:

- `DB_USER` / `DB_PASSWORD` with a SQL login that can create a database (this PC uses a dedicated login, `esevai_app`, instead of `sa`).
- If the **SQL Server Browser** service is not running, set `DB_PORT` to the instance's TCP port (SQL Server Configuration Manager → TCP/IP → IP Addresses → IPAll). A fixed port is best, because a dynamic port can change when SQL Server restarts.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` with the first administrator you want (password: 12 characters or more).

Do **not** put the password in any other file. `.env` is listed in `.gitignore`, so Git will not upload it.

### Step 2: Install the packages

```powershell
cd "D:\Doc control management\backend"
npm install

cd "D:\Doc control management\frontend"
npm install
```

### Step 3: Test the database connection

```powershell
cd "D:\Doc control management\backend"
npm run db:check
```

You should see `Connected...` and `Read and write check passed.` If you see an error, read the **Database connection problems** section below.

### Step 4: Create the database (only if it does not exist yet)

```powershell
npm run db:create
```

This creates only `ESevaiDocumentManager`. It does not change any other database.

### Step 5: Create the tables

```powershell
npm run db:migrate
```

Each migration runs in one transaction. If one fails, nothing from that file is saved.

### Step 6: Create the first Master Admin

```powershell
npm run db:seed-admin
```

Run this once. If a Master Admin already exists, it does nothing.

### Step 7: Start the app

Open two PowerShell windows.

Window 1 (backend):
```powershell
cd "D:\Doc control management\backend"
npm run dev
```

Window 2 (frontend):
```powershell
cd "D:\Doc control management\frontend"
npm run dev
```

Open **http://localhost:5173** in your browser and sign in with the admin username and password from `.env`. If `ADMIN_USERNAME` is not set there, use the `ADMIN_EMAIL` address as the username.

Check that the API is up: **http://localhost:4000/api/health**

---

### Google sign-in setup (optional)

The "Continue with Google" button appears only when both values below are set in `backend\.env`.

1. Open https://console.cloud.google.com and create a project (or pick an existing one).
2. Go to **APIs & Services > OAuth consent screen**. Choose **External**, enter an app name and your email, and save. While the app is in **Testing** mode, only the Gmail addresses listed under **Test users** can sign in, so add each one there.
3. Go to **APIs & Services > Credentials > Create credentials > OAuth client ID**, and choose **Web application**.
4. Under **Authorized redirect URIs**, add exactly: `http://localhost:5173/api/auth/google/callback`
5. Copy the **Client ID** and **Client secret** into `backend\.env`:

   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

6. Restart the backend (`npm run dev`) and open http://localhost:5173.

A new user who signs up with Google becomes the first Admin of a new office account. The office name is taken from the Create account form, and the Gmail address becomes the username. Google accounts have no password, so they sign in only with Google.

---

## 4. Database connection problems

The app never switches to another database or fake data. If SQL Server is not reachable, it stops and shows the real reason.

| Error text (what you may see) | What to do |
|---|---|
| `Login failed for user 'sa'` | The password in `backend\.env` is wrong. Check `DB_PASSWORD`. |
| `Cannot open database "ESevaiDocumentManager"` | Run `npm run db:create` first. |
| `Failed to connect to ABHILASH:1433` or `ECONNREFUSED` | Named instances use a dynamic port. Open **SQL Server Configuration Manager**, enable **TCP/IP** for SQLEXPRESS, and start **SQL Server Browser** service. |
| `The server was not found or was not accessible` | Check the name `ABHILASH\SQLEXPRESS` in SSMS. Make sure the SQL Server service is running (`services.msc`). |
| `SQL Server login is not enabled` / `Login failed` | In SSMS, open Security > Logins > sa, enable it, and set **SQL Server and Windows Authentication mode** in Server Properties > Security. Restart the service. |
| `self-signed certificate` / `certificate chain` | Keep `DB_TRUST_SERVER_CERTIFICATE=true` (local development only). |

Your SQL Server version is 2022 (16.x), so the `mssql` driver used here is compatible.

---

## 5. Security notes (for learning)

- **Passwords** are hashed with Argon2id. The database never stores the real password.
- **Sessions**: after sign-in, the browser gets a random token in an HttpOnly cookie. The database stores only a SHA-256 hash of it.
- **Lockout**: 5 wrong passwords lock the account for 15 minutes (configurable in `.env`).
- **Rate limit**: 20 sign-in attempts per 15 minutes per network address.
- **Roles** are checked on the server. The frontend's display of menus is only cosmetic.
- **Errors** shown to users are generic. Full details go to the server console only.

---

## 6. Useful commands

| Command (run in `backend`) | What it does |
|---|---|
| `npm run dev` | Start the API with auto-reload |
| `npm run db:check` | Test the connection and a read/write |
| `npm run db:create` | Create the database if missing |
| `npm run db:migrate` | Apply new migrations |
| `npm run db:seed-admin` | Create the first Master Admin |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run the backend unit tests |

| Command (run in `frontend`) | What it does |
|---|---|
| `npm run dev` | Start the website on http://localhost:5173 |
| `npm run build` | Type-check and build the website |
| `npm run test:e2e` | Run the end-to-end browser test in Microsoft Edge (both servers must be running). Set `$env:E2E_USERNAME` and `$env:E2E_PASSWORD` to an **office Admin** first. The test creates and then archives an "E2E ..." template and document. |

### Where files are stored

Uploaded files go to `backend\storage\` (change it with `STORAGE_DIR` in `.env`). The folder is excluded from Git. **Back it up together with the database:** the database holds the document records, and this folder holds the file bytes.

After changing `backend\.env`, restart the backend (`Ctrl+C`, then `npm run dev`), because settings are read only at start-up.
