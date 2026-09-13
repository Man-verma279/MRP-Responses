-- ==============================================================================
-- RESEARCH SURVEY APPLICATION - SQLITE3 SCHEMA
-- Topic: Impulse Buying Behaviour in Online vs Offline Markets
-- Candidate: MAN MACHYA (Roll: 252380042) | DAVV / MIST Indore
-- ==============================================================================

-- 1. Main Responses Table
CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    response_uuid TEXT UNIQUE NOT NULL,
    response_code TEXT UNIQUE NOT NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Demographics & Screening (Section 1)
    name TEXT NOT NULL DEFAULT 'Anonymous Respondent',
    full_name TEXT NOT NULL DEFAULT 'Anonymous Respondent',
    age_group TEXT NOT NULL,
    gender TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    region_classification TEXT NOT NULL, -- 'Indore Hub', 'Rest of MP', 'Major North India', 'Other States'
    mp_flag INTEGER NOT NULL DEFAULT 0,  -- 1 if MP, 0 otherwise
    indore_flag INTEGER NOT NULL DEFAULT 0, -- 1 if Indore, 0 otherwise
    occupation TEXT NOT NULL,
    income_group TEXT,
    
    -- General Shopping Habits (Section 2)
    q07_online_impulse_freq TEXT NOT NULL,
    q08_offline_impulse_freq TEXT NOT NULL,
    q09_avg_unplanned_spend TEXT NOT NULL,
    preferred_channel TEXT NOT NULL, -- 'Online', 'Offline', 'Hybrid'
    
    -- In-Store Offline Sensory Experience (Section 3: Likert 1-5)
    q10_need_for_touch INTEGER NOT NULL CHECK (q10_need_for_touch BETWEEN 1 AND 5),
    q11_visual_displays INTEGER NOT NULL CHECK (q11_visual_displays BETWEEN 1 AND 5),
    q12_checkout_placement INTEGER NOT NULL CHECK (q12_checkout_placement BETWEEN 1 AND 5),
    q13_salesperson_advice INTEGER NOT NULL CHECK (q13_salesperson_advice BETWEEN 1 AND 5),
    
    -- Online Shopping & Social Media Triggers (Section 4: Likert 1-5)
    q14_ai_recommendations INTEGER NOT NULL CHECK (q14_ai_recommendations BETWEEN 1 AND 5),
    q15_countdown_timers INTEGER NOT NULL CHECK (q15_countdown_timers BETWEEN 1 AND 5),
    q16_scarcity_fomo INTEGER NOT NULL CHECK (q16_scarcity_fomo BETWEEN 1 AND 5),
    q17_social_proof_reviews INTEGER NOT NULL CHECK (q17_social_proof_reviews BETWEEN 1 AND 5),
    q18_push_notifications INTEGER NOT NULL CHECK (q18_push_notifications BETWEEN 1 AND 5),
    
    -- Payment Methods & Spending Ease (Section 5)
    q19_primary_payment_mode TEXT NOT NULL,
    q20_upi_pain_reduction INTEGER NOT NULL CHECK (q20_upi_pain_reduction BETWEEN 1 AND 5),
    q21_bnpl_spend_encouragement INTEGER NOT NULL CHECK (q21_bnpl_spend_encouragement BETWEEN 1 AND 5),
    fintech_user_flag INTEGER NOT NULL DEFAULT 0, -- 1 if UPI or BNPL
    
    -- Post-Purchase Regret, Returns & Trust (Section 6: Likert 1-5)
    q22_online_impulse_regret INTEGER NOT NULL CHECK (q22_online_impulse_regret BETWEEN 1 AND 5),
    q23_offline_satisfaction INTEGER NOT NULL CHECK (q23_offline_satisfaction BETWEEN 1 AND 5),
    q24_return_exchange_freq INTEGER NOT NULL CHECK (q24_return_exchange_freq BETWEEN 1 AND 5),
    q25_fake_timers_loss_of_trust INTEGER NOT NULL CHECK (q25_fake_timers_loss_of_trust BETWEEN 1 AND 5),
    
    -- Research Metadata & Integrity Tag
    is_demo INTEGER NOT NULL DEFAULT 0, -- 0 = GENUINE REAL RESPONSE, 1 = SYNTHETIC DEMO / BENCHMARK
    data_source TEXT NOT NULL DEFAULT 'LIVE_RESEARCH_PARTICIPANT', -- 'LIVE_RESEARCH_PARTICIPANT' or 'SYNTHETIC_BENCHMARK_TEST'
    client_user_agent TEXT,
    ip_hash TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Admin Users Table (For Secure Dashboard Access)
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_responses_region ON responses(region_classification);
CREATE INDEX IF NOT EXISTS idx_responses_channel ON responses(preferred_channel);
CREATE INDEX IF NOT EXISTS idx_responses_is_demo ON responses(is_demo);
CREATE INDEX IF NOT EXISTS idx_responses_submitted ON responses(submitted_at);
CREATE INDEX IF NOT EXISTS idx_responses_code ON responses(response_code);
CREATE INDEX IF NOT EXISTS idx_responses_name ON responses(name);
CREATE INDEX IF NOT EXISTS idx_responses_full_name ON responses(full_name);
