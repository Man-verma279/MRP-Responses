// Determine API Base URL: If loaded via file:/// or static server, point to http://localhost:3000
const API_BASE = (window.location.protocol === 'file:' || !window.location.port) 
    ? 'http://localhost:3000' 
    : '';

let currentStep = 1;
const totalSteps = 6;

const sectionTitles = [
    "Section 1 of 6: About You",
    "Section 2 of 6: General Shopping Habits",
    "Section 3 of 6: In-Store (Offline) Experience",
    "Section 4 of 6: Online Shopping & Digital Triggers",
    "Section 5 of 6: Payment Methods & Spending Ease",
    "Section 6 of 6: Post-Purchase Outcomes, Regret & Trust"
];

// Map of required fields per section step
const requiredFieldsByStep = {
    1: ['full_name', 'age_group', 'gender', 'city', 'state', 'occupation'],
    2: ['q07_online_impulse_freq', 'q08_offline_impulse_freq', 'q09_avg_unplanned_spend'],
    3: ['q10_need_for_touch', 'q11_visual_displays', 'q12_checkout_placement', 'q13_salesperson_advice'],
    4: ['q14_ai_recommendations', 'q15_countdown_timers', 'q16_scarcity_fomo', 'q17_social_proof_reviews', 'q18_push_notifications'],
    5: ['q19_primary_payment_mode', 'q20_upi_pain_reduction', 'q21_bnpl_spend_encouragement'],
    6: ['q22_online_impulse_regret', 'q23_offline_satisfaction', 'q24_return_exchange_freq', 'q25_fake_timers_loss_of_trust']
};

document.addEventListener('DOMContentLoaded', () => {
    updateProgressUI();
    attachLiveInputListeners();
    initShareLinks();
});

// Update progress bar and navigation buttons
function updateProgressUI() {
    const percent = Math.round((currentStep / totalSteps) * 100);
    document.getElementById('stepLabel').innerText = sectionTitles[currentStep - 1];
    document.getElementById('progressPercent').innerText = `${percent}% Complete`;
    document.getElementById('progressBarFill').style.width = `${percent}%`;

    // Show/hide sections
    for (let i = 1; i <= totalSteps; i++) {
        const secEl = document.getElementById(`section${i}`);
        if (secEl) {
            secEl.style.display = (i === currentStep) ? 'block' : 'none';
        }
    }

    // Button states
    const btnBack = document.getElementById('btnBack');
    const btnNext = document.getElementById('btnNext');
    const btnSubmit = document.getElementById('btnSubmit');

    btnBack.style.display = (currentStep > 1) ? 'inline-flex' : 'none';

    if (currentStep === totalSteps) {
        btnNext.style.display = 'none';
        btnSubmit.style.display = 'inline-flex';
    } else {
        btnNext.style.display = 'inline-flex';
        btnSubmit.style.display = 'none';
    }

    // Scroll smoothly to top of form
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Navigate Next / Back
function navigateStep(direction) {
    if (direction === 1) {
        // Validate current step before advancing
        if (!validateCurrentStep()) {
            showToast('Please answer all required questions before proceeding.');
            return;
        }
        if (currentStep < totalSteps) {
            currentStep++;
            updateProgressUI();
        }
    } else if (direction === -1) {
        if (currentStep > 1) {
            currentStep--;
            updateProgressUI();
        }
    }
}

// Validate fields in the active step
function validateCurrentStep() {
    const fields = requiredFieldsByStep[currentStep] || [];
    let isValid = true;
    let firstErrorCard = null;

    fields.forEach(fieldName => {
        let isFilled = false;
        const textOrSelect = document.querySelector(`input[name="${fieldName}"][type="text"], select[name="${fieldName}"]`);
        
        if (textOrSelect) {
            isFilled = textOrSelect.value.trim() !== '';
        } else {
            const checkedRadio = document.querySelector(`input[name="${fieldName}"]:checked`);
            isFilled = !!checkedRadio;
        }

        const card = document.getElementById(`card_${fieldName}`);
        if (!isFilled) {
            isValid = false;
            if (card) {
                card.classList.add('has-error');
                if (!firstErrorCard) firstErrorCard = card;
            }
        } else {
            if (card) card.classList.remove('has-error');
        }
    });

    if (firstErrorCard) {
        firstErrorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return isValid;
}

// Clear error status as soon as participant interacts with a field
function attachLiveInputListeners() {
    const form = document.getElementById('surveyForm');
    form.addEventListener('input', (e) => {
        const fieldName = e.target.name;
        if (fieldName) {
            const card = document.getElementById(`card_${fieldName}`);
            if (card) card.classList.remove('has-error');
        }
    });
    form.addEventListener('change', (e) => {
        const fieldName = e.target.name;
        if (fieldName) {
            const card = document.getElementById(`card_${fieldName}`);
            if (card) card.classList.remove('has-error');
        }
    });
}

// Form Submission Handler
document.getElementById('surveyForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate final step
    if (!validateCurrentStep()) {
        showToast('Please answer all required questions before submitting.');
        return;
    }

    const form = document.getElementById('surveyForm');
    const formData = new FormData(form);
    const payload = {};

    formData.forEach((value, key) => {
        payload[key] = value;
    });
    if (payload.full_name && !payload.name) {
        payload.name = payload.full_name;
    }
    if (payload.name && !payload.full_name) {
        payload.full_name = payload.name;
    }

    // UI Loading state
    const btnSubmit = document.getElementById('btnSubmit');
    const btnBack = document.getElementById('btnBack');
    const submitText = document.getElementById('submitBtnText');
    const spinner = document.getElementById('submitSpinner');

    btnSubmit.disabled = true;
    btnBack.disabled = true;
    submitText.style.display = 'none';
    spinner.style.display = 'inline-block';

    try {
        const res = await fetch(`${API_BASE}/api/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success) {
            // Show Success Card
            document.getElementById('surveyForm').style.display = 'none';
            document.getElementById('progressContainer').style.display = 'none';
            document.getElementById('formHeaderCard').style.display = 'none';
            
            const successCard = document.getElementById('successCard');
            document.getElementById('displayResponseCode').innerText = data.response_id || 'RESP-SUCCESS';
            successCard.style.display = 'block';

            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            showToast(data.error || 'Submission failed. Please check your answers.');
            btnSubmit.disabled = false;
            btnBack.disabled = false;
            submitText.style.display = 'inline-block';
            spinner.style.display = 'none';
        }
    } catch (err) {
        console.error('Submission error:', err);
        showToast('Network error while connecting to research server. Please try again.');
        btnSubmit.disabled = false;
        btnBack.disabled = false;
        submitText.style.display = 'inline-block';
        spinner.style.display = 'none';
    }
});

// Social Share Link Initialization
function initShareLinks() {
    const surveyUrl = window.location.origin + window.location.pathname;
    const shareText = "Help us with our MBA Major Research Project on 'Impulse Buying in Online vs Offline Markets'. Please take this short 3-minute survey: " + surveyUrl;

    const waBtn = document.getElementById('shareWhatsAppBtn');
    if (waBtn) {
        waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    }

    const liBtn = document.getElementById('shareLinkedInBtn');
    if (liBtn) {
        liBtn.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(surveyUrl)}`;
    }
}

// Copy Survey Link to Clipboard
function copySurveyLink() {
    const url = window.location.origin + window.location.pathname;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Survey link copied to clipboard!');
    }).catch(() => {
        showToast('Failed to copy. URL: ' + url);
    });
}

// Toast notification helper
function showToast(message) {
    const toast = document.getElementById('toastMsg');
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);
}
