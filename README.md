# MRP-Responses
## Research Survey Web Application & Admin Analytics Engine
**MBA Major Research Project (MRP) — Semester III**  
**Project Topic:** *Impulse Buying Behaviour in Online vs. Offline Markets: A Multi-Channel Comparative Empirical Study*  
**Candidate:** MAN MACHYA | **Roll No:** 252380042 (Enrollment Ref: 252380130)  
**Supervisor:** Asst. Prof. Sanjana Choudhary | **Institution:** Malwa Institute of Science & Technology, Indore  
**Affiliated University:** Devi Ahilya Vishwavidyalaya, Indore (DAVV)  

---

## 1. Project Overview

This repository contains a full-stack, production-ready research survey web application and real-time administrator analytics engine. It is specifically designed to collect genuine primary survey data from Indian retail consumers across **Indore City**, **Madhya Pradesh**, and **Major North Indian Regions** via WhatsApp, LinkedIn, and peer referral networks.

### Core Architectural Principles:
1. **Zero Fabrication Policy**: The application strictly isolates genuine participant responses (`is_demo = 0`) from benchmark demonstration data (`is_demo = 1`). Real participant submissions are stored directly in SQLite and automatically synchronized into `data/raw_responses.xlsx` and `data/raw_responses.csv`.
2. **Google Forms Inspired User Experience**: A clean, modern, multi-step card layout with real-time validation, linear Likert scale selectors (1 to 5), progress indicators, and mobile responsiveness.
3. **Protected Admin Analytics Dashboard**: Accessible at `/admin`, protected by session authentication, reading directly from SQLite with live KPI metric cards, dynamic Chart.js analytics, searchable response tables, full response modal views, and 1-click Excel/CSV data exports.
4. **Vercel & Cloud Deployment Ready**: Built with a decoupled database abstraction layer supporting local SQLite3 (`sql.js`) and cloud-hosted persistent SQLite (Turso / libSQL) for serverless deployment.

---

## 2. Directory Structure

```
/research-survey-app
│
├── frontend/                     # Frontend source assets and components
├── backend/                      # Node.js / Express backend server & REST API
│   ├── server.js                 # Central application entry point
│   ├── db.js                     # Abstracted database access layer (SQLite / Turso)
│   ├── exportService.js          # SQLite -> Excel/CSV data synchronization engine
│   ├── seedDemoData.js           # Seeds benchmark test data with is_demo = 1
│   └── routes/
│       ├── survey.js             # Public submission API (POST /api/responses)
│       ├── auth.js               # Admin authentication (POST /api/admin/login)
│       └── admin.js              # Protected analytics, table data, and streaming exports
│
├── database/
│   ├── schema.sql                # Complete SQLite schema definition
│   ├── init_db.js                # Database initialization script
│   └── research.sqlite3          # Binary SQLite database (Single source of truth)
│
├── data/
│   ├── raw_responses.xlsx        # Automatically synchronized real survey responses
│   ├── raw_responses.csv         # Raw CSV format of real survey responses
│   └── demo_data.xlsx            # Clearly marked: "SYNTHETIC DEMO DATA — NOT REAL"
│
├── exports/
│   └── latest_responses.xlsx     # Generated administrative export archives
│
├── public/                       # Static public assets served by Express & Vercel
│   ├── index.html                # Public survey form (Google Forms inspired UI)
│   ├── admin.html                # Administrator research analytics dashboard
│   ├── css/
│   │   ├── survey.css            # Survey form stylesheet with progress indicators
│   │   └── admin.css             # Dark-themed executive admin dashboard stylesheet
│   └── js/
│       ├── survey.js             # Form validation, step navigation & submission logic
│       └── admin.js              # Real-time Chart.js rendering, filters & modal viewer
│
├── vercel.json                   # Vercel serverless deployment routing configuration
├── .env.example                  # Environment variable template
├── package.json                  # Dependencies and execution scripts
└── README.md                     # Comprehensive technical documentation
```

---

## 3. Public Survey Questionnaire (25 Items Across 6 Sections)

The survey implements the standardized measurement framework approved for this research:
* **Section 1: About You (Screening & Demographics)**:
  * Q01: Age Group (18–24, 25–34, 35–49, 50+)
  * Q02: Gender (Female, Male, Prefer not to say)
  * Q03: City (Indore, Bhopal, Delhi NCR, Jaipur, Lucknow, etc.)
  * Q04: State / Region (Madhya Pradesh, Delhi NCR, UP, Rajasthan, Punjab, etc.)
  * Q05: Occupation (Student, Salaried, Business, Homemaker)
  * Q06: Approximate Monthly Family Income (Optional)
* **Section 2: General Shopping Habits**:
  * Q07: Online unplanned purchase frequency
  * Q08: Offline in-store unplanned purchase frequency
  * Q09: Typical monetary spend per impulse purchase
* **Section 3: In-Store (Offline) Experience (Sensory Intensity, 1-5 Likert)**:
  * Q10: Need for Touch (NFT — physical tactile product evaluation)
  * Q11: Visual store merchandising & mannequin displays
  * Q12: Cashier/billing counter impulse grab placement
  * Q13: Salesperson consultative reassurance
* **Section 4: Online Shopping & Digital Triggers (Algorithmic Intensity, 1-5 Likert)**:
  * Q14: AI recommendation accuracy ("Suggested for You")
  * Q15: Countdown urgency timers ("Sale ends in 15 mins!")
  * Q16: Stock scarcity FOMO alerts ("Only 1 left in stock!")
  * Q17: Social proof photo reviews & influencer recommendations
  * Q18: Mobile app push notifications & flash sale alerts
* **Section 5: Payment Methods & Spending Ease (Financial Nudges)**:
  * Q19: Primary payment instrument (UPI, Cash, Cards, BNPL)
  * Q20: UPI frictionless convenience reducing the "pain of paying"
  * Q21: Buy Now Pay Later (BNPL) credit liquidity decoupling
* **Section 6: Post-Purchase Outcomes (Regret, Returns & Trust, 1-5 Likert)**:
  * Q22: Online buyer's remorse & cognitive regret
  * Q23: Offline sensory pre-purchase satisfaction
  * Q24: Product return/exchange frequency (apparel/footwear sizing mismatch)
  * Q25: Deceptive countdown timers ("dark patterns") eroding platform trust

---

## 4. Setup & Running Locally

### Prerequisites
* **Node.js**: Version 18+ or 20 LTS
* **npm**: Version 9+ or 10+

### Step 1: Install Dependencies
```bash
cd research-survey-app
npm install
```

### Step 2: Initialize Database
```bash
npm run init-db
```
*Creates `database/research.sqlite3`, runs `schema.sql`, and provisions the default administrator account.*

### Step 3: Seed Benchmark Demonstration Data (Optional for Testing)
```bash
npm run seed-demo
```
*Populates 200 benchmark test records with `is_demo = 1` and creates `data/demo_data.xlsx`. Genuine responses submitted via the public form will be stored with `is_demo = 0`.*

### Step 4: Start the Server
```bash
npm start
```
* The Public Survey is live at: **`http://localhost:3000/`**
* The Admin Dashboard is live at: **`http://localhost:3000/admin`**

---

## 5. Admin Dashboard Credentials & Access

* **URL:** `http://localhost:3000/admin`
* **Default Username:** `admin`
* **Default Password:** `admin123` *(Configurable in `.env` via `ADMIN_PASSWORD`)*

### Key Admin Features:
1. **Live SQLite Counters**: Cards for Total Responses, Today's Submissions, This Week, This Month, States, and Cities update directly from SQLite queries.
2. **Interactive Toggle Switch**:
   * **Real Submissions Only (Default)**: Displays only genuine respondents recruited via WhatsApp/LinkedIn.
   * **Benchmark Demo Mode**: Displays the 200 pre-seeded benchmark test rows for viva-voce presentation and demonstration.
3. **Interactive Chart.js Analytics**: Visualizations for Regional distribution, Online vs. Offline channel split, Trigger Likert averages, Payment modes, and Daily submission cadence.
4. **Interactive Response Table**: Search by ID, city, state, or filter by channel and payment mode.
5. **View Response Modal**: Clicking "View" displays the complete 25-item questionnaire response for that individual respondent.
6. **Streaming Exports**: Download latest real participant data as `.xlsx` or `.csv` at any time.

---

## 6. Social Media & Link Sharing

The survey form includes automated one-click sharing widgets:
* **WhatsApp Share**: Pre-populates a polite research survey invitation message with the survey link.
* **LinkedIn Share**: Pre-formats an academic research post for professional network distribution.
* **Copy Link**: Copies the live URL to the participant's clipboard with instant visual toast confirmation.

---

## 7. Vercel Serverless Deployment

Because Vercel serverless functions have ephemeral local filesystems, local file writes to `database/research.sqlite3` reset across cold starts. To maintain a persistent SQLite database in production on Vercel:

### Option A: Using Turso / libSQL (Recommended for Vercel)
1. Sign up for a free cloud SQLite database at [turso.tech](https://turso.tech).
2. Create a database:
   ```bash
   turso db create mrp-survey-db
   ```
3. Get the database URL and auth token:
   ```bash
   turso db show mrp-survey-db --url
   turso db tokens create mrp-survey-db
   ```
4. Set the environment variables in your Vercel Project Settings:
   * `TURSO_DATABASE_URL` = `libsql://mrp-survey-db-[username].turso.io`
   * `TURSO_AUTH_TOKEN` = `your-turso-token`
   * `ADMIN_PASSWORD` = `your-secure-admin-password`

### Option B: Deploying with Vercel CLI
```bash
npm i -g vercel
vercel
```
*Vercel will detect `vercel.json`, deploy static assets to the Vercel Edge Network, and route `/api/*` to the Node.js serverless functions.*

---

## 8. Research Data Integrity Compliance

* In accordance with institutional research ethics, this application **never generates fake respondents and presents them as genuine**.
* Any demonstration data used for testing formulas or dashboard layouts is strictly isolated with `is_demo = 1` and saved in `data/demo_data.xlsx`.
* The primary dataset file `data/raw_responses.xlsx` contains solely genuine participant submissions recorded via the deployed web form.
