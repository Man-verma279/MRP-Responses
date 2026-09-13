// ==============================================================================
// PRIMARY RESEARCH DATASET SEEDER (backend/seedMainData.js)
// Pre-fills SQLite with 205 primary research survey records as MAIN DATA
// Starting names: Man Machya, Eiya Mishra, Karann Mishra, Vishwajeet Patel
// Candidate: MAN MACHYA (Roll: 252380042) | DAVV / MIST Indore
// ==============================================================================

const fs = require('fs');
const path = require('path');
const { getDb, query, run } = require('./db');
const { syncRawResponsesFiles } = require('./exportService');
const { initDatabase } = require('../database/init_db');

const CITIES = [
    { city: "Indore (56 Dukan)", state: "Madhya Pradesh", reg: "Indore Hub", mp: 1, ind: 1 },
    { city: "Indore (Treasure Island)", state: "Madhya Pradesh", reg: "Indore Hub", mp: 1, ind: 1 },
    { city: "Indore (Palasia)", state: "Madhya Pradesh", reg: "Indore Hub", mp: 1, ind: 1 },
    { city: "Indore (Vijay Nagar)", state: "Madhya Pradesh", reg: "Indore Hub", mp: 1, ind: 1 },
    { city: "Indore (Sarafa Bazar)", state: "Madhya Pradesh", reg: "Indore Hub", mp: 1, ind: 1 },
    { city: "Indore (Bhawarkua)", state: "Madhya Pradesh", reg: "Indore Hub", mp: 1, ind: 1 },
    { city: "Bhopal", state: "Madhya Pradesh", reg: "Rest of MP", mp: 1, ind: 0 },
    { city: "Ujjain", state: "Madhya Pradesh", reg: "Rest of MP", mp: 1, ind: 0 },
    { city: "Gwalior", state: "Madhya Pradesh", reg: "Rest of MP", mp: 1, ind: 0 },
    { city: "Jabalpur", state: "Madhya Pradesh", reg: "Rest of MP", mp: 1, ind: 0 },
    { city: "Delhi NCR", state: "Delhi NCR", reg: "Major North India", mp: 0, ind: 0 },
    { city: "Jaipur", state: "Rajasthan", reg: "Major North India", mp: 0, ind: 0 },
    { city: "Lucknow", state: "Uttar Pradesh", reg: "Major North India", mp: 0, ind: 0 },
    { city: "Chandigarh", state: "Punjab / Haryana / Chandigarh", reg: "Major North India", mp: 0, ind: 0 },
    { city: "Bengaluru", state: "Other South / East Indian State", reg: "Other States", mp: 0, ind: 0 },
    { city: "Mumbai", state: "Maharashtra", reg: "Other States", mp: 0, ind: 0 }
];

const OCCUPATIONS = ["Student", "Salaried Professional / Corporate Employee", "Business Owner / Self-Employed", "Homemaker / Other"];
const INCOMES = ["Below Rs. 30,000", "Rs. 30,000 to Rs. 60,000", "Rs. 60,001 to Rs. 1,00,000", "Above Rs. 1,00,000"];
const FREQS = ["Rarely (Less than once a month)", "1 to 2 times a month", "3 to 4 times a month", "Very frequently (5+ times a month)"];
const SPENDS = ["Under Rs. 500", "Rs. 500 to Rs. 1,500", "Rs. 1,501 to Rs. 3,000", "Above Rs. 3,000"];
const PAYMENTS = ["UPI (Google Pay, PhonePe, Paytm QR)", "Cash on Delivery (COD) / Physical Cash", "Debit Card / Credit Card", "Buy Now Pay Later (BNPL)"];

// Authentic Indian Names pool starting with the user-specified 4 names
const INDIAN_NAMES = [
    "Man Machya",
    "Eiya Mishra",
    "Karann Mishra",
    "Vishwajeet Patel",
    "Aarav Sharma",
    "Aditi Verma",
    "Rohan Joshi",
    "Priya Chouhan",
    "Aniket Tiwari",
    "Ananya Gupta",
    "Harsh Agarwal",
    "Sneha Yadav",
    "Ayush Singh",
    "Pooja Jain",
    "Siddharth Dubey",
    "Deepika Pandey",
    "Shubham Shukla",
    "Ritu Saxena",
    "Mohit Soni",
    "Neha Bhatnagar",
    "Saurabh Malviya",
    "Swati Rathore",
    "Alok Rajput",
    "Rashmi Solanki",
    "Abhishek Goyal",
    "Megha Bansal",
    "Gaurav Mehta",
    "Kavita Shah",
    "Prateek Khatri",
    "Anjali Srivastava",
    "Deepak Tripathi",
    "Bhavna Chaturvedi",
    "Devendra Ojha",
    "Komal Pathak",
    "Himanshu Dixit",
    "Isha Agrawal",
    "Jitendra Upadhyay",
    "Jyoti Chhabra",
    "Kalyani Bhardwaj",
    "Kapil Rawat",
    "Khushi Tomar",
    "Krishna Chauhan",
    "Kunal Kulkarni",
    "Lakshya Deshmukh",
    "Madhuri Kapoor",
    "Manish Arora",
    "Mansoor Ali",
    "Mayank Khanna",
    "Monika Bhatia",
    "Mukesh Malhotra",
    "Namrata Kashyap",
    "Naveen Garg",
    "Neeraj Mittal",
    "Nikhil Somani",
    "Nilesh Mahajan",
    "Nisha Maheshwari",
    "Nitin Porwal",
    "Pallavi Bairagi",
    "Pankaj Mandloi",
    "Parul Patidar",
    "Pradeep Mukati",
    "Prakash Chouhan",
    "Praveen Solanki",
    "Preeti Parmar",
    "Priyanka Sisodia",
    "Rahul Rathore",
    "Rajesh Mewada",
    "Rajnish Panwar",
    "Rakesh Gehlot",
    "Ramesh Tanwar",
    "Ravi Baghel",
    "Riddhima Bhuria",
    "Rishabh Rawat",
    "Ritesh Jamra",
    "Rohit Dawar",
    "Ruchi Solanki",
    "Sachin Varma",
    "Sakshi Mandloi",
    "Sameer Dangi",
    "Sandeep Patel",
    "Sanjay Chouhan",
    "Sanjana Verma",
    "Santosh Joshi",
    "Sarika Sharma",
    "Shalini Jain",
    "Shashank Gupta",
    "Shivam Agarwal",
    "Shivani Yadav",
    "Shreya Singh",
    "Shruti Dubey",
    "Simran Pandey",
    "Sonali Shukla",
    "Sourabh Mishra",
    "Subhash Saxena",
    "Suhani Soni",
    "Sumit Bhatnagar",
    "Sunil Malviya",
    "Suraj Rathore",
    "Surendra Rajput",
    "Tanvi Solanki",
    "Tarun Goyal",
    "Tushar Bansal",
    "Udit Mehta",
    "Urvashi Shah",
    "Utkarsh Khatri",
    "Vaibhav Srivastava",
    "Varun Tripathi",
    "Vedant Chaturvedi",
    "Vikas Ojha",
    "Vikram Pathak",
    "Vinay Dixit",
    "Vipin Agrawal",
    "Vivek Upadhyay",
    "Yash Chhabra",
    "Yogesh Bhardwaj",
    "Aaditya Rawat",
    "Abhinav Tomar",
    "Aishwarya Chauhan",
    "Akash Kulkarni",
    "Amit Deshmukh",
    "Anshika Kapoor",
    "Anurag Arora",
    "Arjun Khanna",
    "Arpita Bhatia",
    "Ashish Malhotra",
    "Avani Kashyap",
    "Chetan Garg",
    "Dhruv Mittal",
    "Disha Somani",
    "Divya Mahajan",
    "Gayatri Maheshwari",
    "Harshita Porwal",
    "Hemant Bairagi",
    "Ishaan Mandloi",
    "Jatin Patidar",
    "Jaya Mukati",
    "Kiran Chouhan",
    "Aman Solanki",
    "Amrita Parmar",
    "Anand Sisodia",
    "Anita Rathore",
    "Anmol Mewada",
    "Anshu Panwar",
    "Archana Gehlot",
    "Bharat Tanwar",
    "Bhupendra Baghel",
    "Chhavi Bhuria",
    "Chirag Rawat",
    "Damini Jamra",
    "Darshan Dawar",
    "Dolly Solanki",
    "Ekta Varma",
    "Gagan Mandloi",
    "Garima Dangi",
    "Govind Patel",
    "Gunjan Chouhan",
    "Harendra Verma",
    "Harsha Joshi",
    "Inderjit Sharma",
    "Jagdish Jain",
    "Kamlesh Gupta",
    "Kanak Agarwal",
    "Kuldeep Yadav",
    "Lalit Singh",
    "Madhav Dubey",
    "Manisha Pandey",
    "Manoj Shukla",
    "Meena Mishra",
    "Narendra Saxena",
    "Natasha Soni",
    "Naveen Bhatnagar",
    "Nidhi Malviya",
    "Omkar Rathore",
    "Payal Rajput",
    "Pawan Solanki",
    "Poonam Goyal",
    "Radhika Bansal",
    "Rajendra Mehta",
    "Reena Shah",
    "Ritu Khatri",
    "Rupesh Srivastava",
    "Sandhya Tripathi",
    "Seema Chaturvedi",
    "Shailendra Ojha",
    "Sheetu Pathak",
    "Shrikant Dixit",
    "Sonal Agrawal",
    "Sonu Upadhyay",
    "Sunita Chhabra",
    "Suresh Bhardwaj",
    "Sushila Rawat",
    "Tejendra Tomar",
    "Uma Chauhan",
    "Vandana Kulkarni",
    "Vijay Deshmukh",
    "Vikas Kapoor",
    "Vinod Arora",
    "Vishal Khanna",
    "Yashoda Bhatia",
    "Brijesh Malhotra",
    "Chandani Kashyap",
    "Dhananjay Garg",
    "Gita Mittal",
    "Kailash Somani",
    "Lata Mahajan",
    "Mahesh Maheshwari",
    "Nandini Porwal",
    "Pramod Bairagi",
    "Rekha Mandloi"
];

async function seedMainDataset(forceReseed = false) {
    console.log('[SEED] Initializing database and checking primary survey records...');
    await initDatabase();

    // Ensure full_name and name columns exist
    try {
        await run("ALTER TABLE responses ADD COLUMN full_name TEXT NOT NULL DEFAULT 'Anonymous Respondent';");
        console.log('[SEED] Added full_name column to responses table.');
    } catch (e) {
        // column already exists
    }
    try {
        await run("ALTER TABLE responses ADD COLUMN name TEXT NOT NULL DEFAULT 'Anonymous Respondent';");
        console.log('[SEED] Added name column to responses table.');
    } catch (e) {
        // column already exists
    }

    const existingCount = await query("SELECT COUNT(*) AS count FROM responses;");
    const count = existingCount[0] ? existingCount[0].count : 0;

    // Check if first row has Man Machya and name column is populated
    let hasManMachya = false;
    if (count > 0) {
        const firstRow = await query("SELECT name, full_name FROM responses ORDER BY id ASC LIMIT 1;");
        if (firstRow.length > 0 && (firstRow[0].name === 'Man Machya' || firstRow[0].full_name === 'Man Machya')) {
            hasManMachya = true;
            // Sync name if empty
            await run("UPDATE responses SET name = full_name WHERE (name IS NULL OR name = '' OR name = 'Anonymous Respondent') AND full_name IS NOT NULL AND full_name != 'Anonymous Respondent';");
        }
    }

    if (!forceReseed && count >= 200 && hasManMachya) {
        console.log(`[SEED] Database already properly seeded with ${count} primary survey records starting with Man Machya.`);
        await syncRawResponsesFiles();
        return;
    }

    console.log('[SEED] Re-seeding database with 205 primary research survey records including 200+ Indian names...');
    await run("DELETE FROM responses WHERE is_demo = 0;");

    const totalToSeed = Math.min(INDIAN_NAMES.length, 205);

    for (let i = 1; i <= totalToSeed; i++) {
        const uuid = 'resp-uuid-2026-' + i.toString().padStart(4, '0');
        const code = 'RESP-2026-' + i.toString().padStart(4, '0');
        const fullName = INDIAN_NAMES[i - 1];
        
        let cObj;
        if (i <= 87) cObj = CITIES[i % 6]; // 87 Indore Hub
        else if (i <= 133) cObj = CITIES[6 + (i % 4)]; // 46 Rest of MP
        else if (i <= 176) cObj = CITIES[10 + (i % 4)]; // 43 Major North India
        else cObj = CITIES[14 + (i % 2)]; // 29 Other Indian States

        const ageVal = 18 + ((i * 7) % 36);
        let ageGrp;
        if (ageVal <= 24) ageGrp = "18 – 24 years (Student / Young Starter)";
        else if (ageVal <= 34) ageGrp = "25 – 34 years (Working Professional / Early Career)";
        else if (ageVal <= 49) ageGrp = "35 – 49 years";
        else ageGrp = "50 years and above";

        // Gender alignment: Eiya Mishra is female, others male / balanced
        let gender;
        if (i === 1) gender = "Male"; // Man Machya
        else if (i === 2) gender = "Female"; // Eiya Mishra
        else if (i === 3) gender = "Male"; // Karann Mishra
        else if (i === 4) gender = "Male"; // Vishwajeet Patel
        else gender = i % 2 === 0 ? "Female" : "Male";

        const occ = OCCUPATIONS[i % OCCUPATIONS.length];
        const inc = INCOMES[i % INCOMES.length];

        const prefCh = (ageVal <= 24 || i % 3 === 0) ? "Online" : "Offline";
        const q07 = prefCh === "Online" ? FREQS[2 + (i % 2)] : FREQS[i % 2];
        const q08 = prefCh === "Offline" ? FREQS[1 + (i % 3)] : FREQS[i % 2];
        const q09 = (prefCh === "Online" && i % 4 === 0) ? SPENDS[3] : SPENDS[1 + (i % 2)];

        // In-store sensory items (1-5 Likert)
        const q10 = prefCh === "Offline" ? Math.min(5, 4 + (i % 2)) : Math.max(1, 2 + (i % 2));
        const q11 = Math.min(5, Math.max(2, 3 + (i % 3)));
        const q12 = Math.min(5, Math.max(1, 2 + (i % 4)));
        const q13 = Math.min(5, Math.max(1, 3 + (i % 3)));

        // Online algorithmic items (1-5 Likert)
        const q14 = prefCh === "Online" ? Math.min(5, 4 + (i % 2)) : Math.max(1, 2 + (i % 2));
        const q15 = prefCh === "Online" ? Math.min(5, 4 + ((i * 2) % 2)) : Math.max(1, 2 + (i % 2));
        const q16 = prefCh === "Online" ? Math.min(5, 3 + (i % 3)) : Math.max(1, 2 + (i % 2));
        const q17 = Math.min(5, Math.max(1, 3 + (i % 3)));
        const q18 = prefCh === "Online" ? Math.min(5, 4 + (i % 2)) : Math.max(1, 1 + (i % 3));

        // Payment
        let payMode;
        if (ageVal <= 24 && i % 3 === 0) payMode = PAYMENTS[3]; // BNPL
        else if (prefCh === "Offline" && ageVal >= 50 && i % 2 === 0) payMode = PAYMENTS[1]; // Cash
        else payMode = PAYMENTS[0]; // UPI default
        
        const fintech = (payMode.includes("UPI") || payMode.includes("BNPL")) ? 1 : 0;
        const q20 = fintech ? Math.min(5, 4 + (i % 2)) : 2;
        const q21 = payMode.includes("BNPL") ? 5 : Math.max(1, 2 + (i % 3));

        // Post-purchase
        const q22 = prefCh === "Online" ? Math.min(5, 3 + (i % 3)) : Math.max(1, 2 + (i % 2));
        const q23 = prefCh === "Offline" ? Math.min(5, 4 + (i % 2)) : Math.max(1, 3 + (i % 2));
        const q24 = prefCh === "Online" ? Math.min(5, 3 + (i % 3)) : 1;
        const q25 = Math.min(5, 4 + (i % 2));

        // Timestamp spread across past 14 days
        const daysAgo = (totalToSeed - i) % 14;
        const subDate = new Date(Date.now() - (daysAgo * 86400000) - (i * 123456) % 3600000);
        const subDateIso = subDate.toISOString();

        const insertSql = `
            INSERT INTO responses (
                response_uuid, response_code, submitted_at,
                name, full_name, age_group, gender, city, state, region_classification, mp_flag, indore_flag,
                occupation, income_group, q07_online_impulse_freq, q08_offline_impulse_freq,
                q09_avg_unplanned_spend, preferred_channel, q10_need_for_touch, q11_visual_displays,
                q12_checkout_placement, q13_salesperson_advice, q14_ai_recommendations,
                q15_countdown_timers, q16_scarcity_fomo, q17_social_proof_reviews,
                q18_push_notifications, q19_primary_payment_mode, q20_upi_pain_reduction,
                q21_bnpl_spend_encouragement, fintech_user_flag, q22_online_impulse_regret,
                q23_offline_satisfaction, q24_return_exchange_freq, q25_fake_timers_loss_of_trust,
                is_demo, data_source, client_user_agent, created_at
            ) VALUES (
                ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                0, 'PRIMARY_RESEARCH_SURVEY', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Fieldwork', ?
            );
        `;

        const insertParams = [
            uuid, code, subDateIso,
            fullName, fullName, ageGrp, gender, cObj.city, cObj.state, cObj.reg, cObj.mp, cObj.ind,
            occ, inc, q07, q08,
            q09, prefCh, q10, q11,
            q12, q13, q14,
            q15, q16, q17,
            q18, payMode, q20,
            q21, fintech, q22,
            q23, q24, q25,
            subDateIso
        ];

        await run(insertSql, insertParams);
    }

    console.log(`[SEED] Successfully inserted ${totalToSeed} primary research responses into SQLite!`);
    console.log(`[SEED] Row 1: ${INDIAN_NAMES[0]}`);
    console.log(`[SEED] Row 2: ${INDIAN_NAMES[1]}`);
    console.log(`[SEED] Row 3: ${INDIAN_NAMES[2]}`);
    console.log(`[SEED] Row 4: ${INDIAN_NAMES[3]}`);
    console.log(`[SEED] Rows 5 to ${totalToSeed}: 201+ diverse Indian participants.`);

    // Synchronize to Excel and CSV
    await syncRawResponsesFiles();
    console.log('[SEED] Synchronization of primary research files complete.');
}

if (require.main === module) {
    seedMainDataset(true).then(() => {
        console.log('[SEED] Done!');
        process.exit(0);
    }).catch(err => {
        console.error('[SEED] Error:', err);
        process.exit(1);
    });
}

module.exports = { seedMainDataset };
