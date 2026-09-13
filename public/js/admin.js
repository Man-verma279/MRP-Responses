// ==============================================================================
// ADMIN DASHBOARD CLIENT CONTROLLER (public/js/admin.js)
// Authentication, Live SQLite Data Fetching, Interactive Charts, and Modal Viewer
// ==============================================================================

let adminToken = localStorage.getItem('mrp_admin_token') || sessionStorage.getItem('mrp_admin_token');
let currentPage = 1;
let autoPollTimer = null;

// Chart Instances
let chartRegions = null;
let chartChannels = null;
let chartTriggers = null;
let chartPayments = null;
let chartTimeline = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!adminToken) {
        document.getElementById('authOverlay').style.display = 'flex';
    } else {
        document.getElementById('authOverlay').style.display = 'none';
        const userObj = JSON.parse(localStorage.getItem('mrp_admin_user') || '{}');
        if (userObj.displayName) {
            document.getElementById('userDisplayBadge').innerText = userObj.displayName;
        }
        loadDashboardData();
        toggleAutoPolling();
    }
});

// Admin Login Handler
async function handleAdminLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errEl = document.getElementById('loginError');

    errEl.style.display = 'none';

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            adminToken = data.token;
            localStorage.setItem('mrp_admin_token', adminToken);
            localStorage.setItem('mrp_admin_user', JSON.stringify(data.user || {}));
            document.getElementById('authOverlay').style.display = 'none';
            if (data.user && data.user.displayName) {
                document.getElementById('userDisplayBadge').innerText = data.user.displayName;
            }
            loadDashboardData();
            toggleAutoPolling();
        } else {
            errEl.innerText = data.error || 'Authentication failed.';
            errEl.style.display = 'block';
        }
    } catch (err) {
        console.error('Login request error:', err);
        errEl.innerText = 'Network error contacting server.';
        errEl.style.display = 'block';
    }
}

// Logout Handler
function handleLogout() {
    adminToken = null;
    localStorage.removeItem('mrp_admin_token');
    localStorage.removeItem('mrp_admin_user');
    sessionStorage.removeItem('mrp_admin_token');
    document.getElementById('authOverlay').style.display = 'flex';
    if (autoPollTimer) clearInterval(autoPollTimer);
}

// Toggle 15-second auto-polling
function toggleAutoPolling() {
    const isChecked = document.getElementById('autoPollCheck').checked;
    if (isChecked) {
        if (!autoPollTimer) {
            autoPollTimer = setInterval(() => {
                loadDashboardData(true);
            }, 15000);
        }
    } else {
        if (autoPollTimer) {
            clearInterval(autoPollTimer);
            autoPollTimer = null;
        }
    }
}

// Main Data Fetcher
async function loadDashboardData(isSilent = false) {
    if (!adminToken) return;

    try {
        const statsRes = await fetch('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (statsRes.status === 401) {
            handleLogout();
            return;
        }

        const statsData = await statsRes.json();
        if (statsData.success) {
            updateKPIs(statsData.summary);
            renderCharts(statsData.distributions);
        }

        loadResponsesTable(currentPage);

    } catch (err) {
        console.error('Failed to load dashboard data:', err);
    }
}

// Update KPI Cards
function updateKPIs(sum) {
    document.getElementById('kpiTotal').innerText = sum.total || 0;
    document.getElementById('kpiToday').innerText = sum.today || 0;
    document.getElementById('kpiWeek').innerText = sum.thisWeek || 0;
    document.getElementById('kpiMonth').innerText = sum.thisMonth || 0;
    document.getElementById('kpiStates').innerText = sum.distinctStates || 0;
    document.getElementById('kpiCities').innerText = sum.distinctCities || 0;
    document.getElementById('kpiTotalSub').innerText = `${sum.total} Primary Research Records in SQLite`;
}

// Render / Update Chart.js Visualizations
function renderCharts(dist) {
    Chart.defaults.color = '#94A3B8';
    Chart.defaults.borderColor = '#243556';
    Chart.defaults.font.family = "'Inter', sans-serif";

    // 1. Regional Chart
    const regLabels = (dist.regions || []).map(r => r.label);
    const regCounts = (dist.regions || []).map(r => r.count);

    if (chartRegions) chartRegions.destroy();
    chartRegions = new Chart(document.getElementById('chartRegions'), {
        type: 'bar',
        data: {
            labels: regLabels.length > 0 ? regLabels : ['No Data'],
            datasets: [{
                label: 'Respondents',
                data: regCounts.length > 0 ? regCounts : [0],
                backgroundColor: ['#818CF8', '#38BDF8', '#F59E0B', '#10B981'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Participants' } } }
        }
    });

    // 2. Channel Preference Chart
    const chLabels = (dist.channels || []).map(c => c.label);
    const chCounts = (dist.channels || []).map(c => c.count);

    if (chartChannels) chartChannels.destroy();
    chartChannels = new Chart(document.getElementById('chartChannels'), {
        type: 'doughnut',
        data: {
            labels: chLabels.length > 0 ? chLabels : ['No Data'],
            datasets: [{
                data: chCounts.length > 0 ? chCounts : [0],
                backgroundColor: ['#38BDF8', '#F59E0B', '#818CF8'],
                borderColor: '#131E32',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } }
        }
    });

    // 3. Trigger Ratings Mean Chart
    const tm = dist.triggerMeans || {};
    const trigLabels = ['Touch (NFT)', 'Store Displays', 'Checkout Display', 'AI Recs', 'Timers', 'Scarcity FOMO', 'Social Proof', 'Push Alerts'];
    const trigValues = [
        tm.tactile_touch || 0, tm.visual_displays || 0, tm.checkout_placement || 0,
        tm.ai_recommendations || 0, tm.countdown_timers || 0, tm.scarcity_fomo || 0,
        tm.social_proof || 0, tm.push_alerts || 0
    ];

    if (chartTriggers) chartTriggers.destroy();
    chartTriggers = new Chart(document.getElementById('chartTriggers'), {
        type: 'bar',
        data: {
            labels: trigLabels,
            datasets: [{
                label: 'Average Likert Score (1-5)',
                data: trigValues,
                backgroundColor: '#F59E0B',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { min: 1, max: 5 } }
        }
    });

    // 4. Payments Chart
    const payLabels = (dist.payments || []).map(p => p.label.split('(')[0].trim());
    const payCounts = (dist.payments || []).map(p => p.count);

    if (chartPayments) chartPayments.destroy();
    chartPayments = new Chart(document.getElementById('chartPayments'), {
        type: 'doughnut',
        data: {
            labels: payLabels.length > 0 ? payLabels : ['No Data'],
            datasets: [{
                data: payCounts.length > 0 ? payCounts : [0],
                backgroundColor: ['#10B981', '#38BDF8', '#F59E0B', '#F43F5E'],
                borderColor: '#131E32',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
        }
    });

    // 5. Timeline Chart
    const tlLabels = (dist.timeline || []).map(t => t.date_label);
    const tlCounts = (dist.timeline || []).map(t => t.count);

    if (chartTimeline) chartTimeline.destroy();
    chartTimeline = new Chart(document.getElementById('chartTimeline'), {
        type: 'line',
        data: {
            labels: tlLabels.length > 0 ? tlLabels : ['No Data'],
            datasets: [{
                label: 'Submissions',
                data: tlCounts.length > 0 ? tlCounts : [0],
                borderColor: '#38BDF8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

let currentLimit = 15;
let totalPagesCount = 1;

// Filter and Search Changes
function handleFilterChange() {
    currentPage = 1;
    loadResponsesTable(currentPage);
}

// Fetch and Render Responses Table
async function loadResponsesTable(page = 1) {
    if (!adminToken) return;

    const q = document.getElementById('searchFilter').value.trim();
    const state = document.getElementById('stateFilter').value;
    const channel = document.getElementById('channelFilter').value;
    const payment = document.getElementById('paymentFilter').value;

    const queryParams = new URLSearchParams({
        page,
        limit: currentLimit
    });

    if (q) queryParams.append('q', q);
    if (state) queryParams.append('state', state);
    if (channel) queryParams.append('channel', channel);
    if (payment) queryParams.append('payment', payment);

    try {
        const res = await fetch(`/api/admin/responses?${queryParams.toString()}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        const data = await res.json();
        const tbody = document.getElementById('responsesTableBody');

        if (!res.ok || !data.success || !data.responses || data.responses.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align: center; color: var(--text-muted); padding: 36px;">
                        No survey responses found matching current filters.
                    </td>
                </tr>
            `;
            document.getElementById('paginationInfo').innerText = 'Showing 0 responses';
            return;
        }

        tbody.innerHTML = '';
        data.responses.forEach(r => {
            const tr = document.createElement('tr');
            const dateStr = new Date(r.submitted_at).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short'
            });

            tr.innerHTML = `
                <td><code>${r.response_code}</code></td>
                <td><strong style="color: #F8FAFC;">${r.name || r.full_name || 'Anonymous Respondent'}</strong></td>
                <td style="color: var(--text-muted); font-size: 0.78rem;">${dateStr}</td>
                <td><strong>${r.city}</strong><br><span style="font-size: 0.74rem; color: var(--text-muted);">${r.state}</span></td>
                <td>${r.age_group ? r.age_group.split('(')[0].trim() : ''}<br><span style="font-size: 0.74rem; color: var(--text-muted);">${r.gender} | ${r.occupation}</span></td>
                <td><span class="badge ${r.preferred_channel === 'Online' ? 'badge-online' : 'badge-offline'}">${r.preferred_channel}</span></td>
                <td>${r.q19_primary_payment_mode ? r.q19_primary_payment_mode.split('(')[0].trim() : ''}</td>
                <td>${r.q09_avg_unplanned_spend || '₹0'}</td>
                <td><strong>${r.q22_online_impulse_regret}/5</strong></td>
                <td><span class="badge badge-real">PRIMARY RESEARCH</span></td>
                <td>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        <button class="btn btn-outline" style="padding: 3px 6px; font-size: 0.72rem;" onclick="viewResponseDetail('${r.response_code}')">View</button>
                        <button class="btn btn-outline" style="padding: 3px 6px; font-size: 0.72rem; color: #38BDF8; border-color: rgba(56, 189, 248, 0.4);" onclick="openEditModal('${r.response_code}')">Edit</button>
                        <button class="btn btn-outline" style="padding: 3px 6px; font-size: 0.72rem; color: #F43F5E; border-color: rgba(244, 63, 94, 0.4);" onclick="deleteResponse('${r.response_code}')">Del</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Update Pagination Info
        const p = data.pagination;
        currentPage = p.page;
        totalPagesCount = p.totalPages || 1;
        const start = (p.page - 1) * p.limit + 1;
        const end = Math.min(p.page * p.limit, p.total);
        document.getElementById('paginationInfo').innerText = `Showing ${start} to ${end} of ${p.total} responses`;
        document.getElementById('pageIndicator').innerText = `Page ${p.page} of ${totalPagesCount}`;

        const btnFirst = document.getElementById('btnFirstPage');
        const btnLast = document.getElementById('btnLastPage');
        if (btnFirst) btnFirst.disabled = (p.page <= 1);
        if (btnLast) btnLast.disabled = (p.page >= totalPagesCount);

        document.getElementById('btnPrevPage').disabled = (p.page <= 1);
        document.getElementById('btnNextPage').disabled = (p.page >= totalPagesCount);

    } catch (err) {
        console.error('Error rendering responses table:', err);
    }
}

// Pagination Controls
function changePage(delta) {
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPagesCount) currentPage = totalPagesCount;
    loadResponsesTable(currentPage);
}

function goToPage(pageNumber) {
    currentPage = Math.max(1, Math.min(pageNumber, totalPagesCount));
    loadResponsesTable(currentPage);
}

function goToLastPage() {
    currentPage = totalPagesCount;
    loadResponsesTable(currentPage);
}

function handlePageSizeChange(newSize) {
    currentLimit = parseInt(newSize, 10) || 15;
    currentPage = 1;
    loadResponsesTable(currentPage);
}

// View Full Response Questionnaire
async function viewResponseDetail(respCode) {
    if (!adminToken) return;

    try {
        const res = await fetch(`/api/admin/responses/${respCode}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert('Failed to load response detail.');
            return;
        }

        const r = data.response;
        document.getElementById('modalRespCode').innerText = `Response: ${r.response_code} (${r.data_source || 'PRIMARY_RESEARCH'})`;

        const body = document.getElementById('modalBodyContent');
        body.innerHTML = `
            <div class="detail-section">
                <div class="detail-sec-title">Section 1: Screening & Demographics</div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Respondent Name</div><div class="detail-value" style="font-weight: 700; color: #38BDF8;">${r.name || r.full_name || 'Anonymous Respondent'}</div></div>
                    <div class="detail-item"><div class="detail-label">Age Group</div><div class="detail-value">${r.age_group}</div></div>
                    <div class="detail-item"><div class="detail-label">Gender</div><div class="detail-value">${r.gender}</div></div>
                    <div class="detail-item"><div class="detail-label">City & State</div><div class="detail-value">${r.city}, ${r.state}</div></div>
                    <div class="detail-item"><div class="detail-label">Region Classification</div><div class="detail-value">${r.region_classification}</div></div>
                    <div class="detail-item"><div class="detail-label">Occupation</div><div class="detail-value">${r.occupation}</div></div>
                    <div class="detail-item"><div class="detail-label">Monthly Family Income</div><div class="detail-value">${r.income_group || 'Not Given'}</div></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-sec-title">Section 2: Shopping Habits</div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Online Impulse Freq</div><div class="detail-value">${r.q07_online_impulse_freq}</div></div>
                    <div class="detail-item"><div class="detail-label">Offline Impulse Freq</div><div class="detail-value">${r.q08_offline_impulse_freq}</div></div>
                    <div class="detail-item"><div class="detail-label">Typical Spend</div><div class="detail-value">${r.q09_avg_unplanned_spend}</div></div>
                    <div class="detail-item"><div class="detail-label">Preferred Mode</div><div class="detail-value">${r.preferred_channel}</div></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-sec-title">Section 3: Offline Sensory Experience (1-5 Likert)</div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Q10: Need for Touch</div><div class="detail-value">${r.q10_need_for_touch} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q11: Store Displays</div><div class="detail-value">${r.q11_visual_displays} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q12: Cashier Counter Impulse</div><div class="detail-value">${r.q12_checkout_placement} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q13: Salesperson Advice</div><div class="detail-value">${r.q13_salesperson_advice} / 5</div></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-sec-title">Section 4: Online Algorithmic Triggers (1-5 Likert)</div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Q14: AI Personalization</div><div class="detail-value">${r.q14_ai_recommendations} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q15: Countdown Timers</div><div class="detail-value">${r.q15_countdown_timers} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q16: Stock Scarcity FOMO</div><div class="detail-value">${r.q16_scarcity_fomo} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q17: Social Proof Reviews</div><div class="detail-value">${r.q17_social_proof_reviews} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q18: Push Notifications</div><div class="detail-value">${r.q18_push_notifications} / 5</div></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-sec-title">Section 5: Payment Methods & Ease</div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Q19: Primary Payment</div><div class="detail-value">${r.q19_primary_payment_mode}</div></div>
                    <div class="detail-item"><div class="detail-label">Q20: UPI Pain of Paying</div><div class="detail-value">${r.q20_upi_pain_reduction} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q21: BNPL Spend Lift</div><div class="detail-value">${r.q21_bnpl_spend_encouragement} / 5</div></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-sec-title">Section 6: Post-Purchase Outcomes (1-5 Likert)</div>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Q22: Online Impulse Regret</div><div class="detail-value">${r.q22_online_impulse_regret} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q23: Offline Satisfaction</div><div class="detail-value">${r.q23_offline_satisfaction} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q24: Return / Exchange Freq</div><div class="detail-value">${r.q24_return_exchange_freq} / 5</div></div>
                    <div class="detail-item"><div class="detail-label">Q25: Deceptive Timers Trust Loss</div><div class="detail-value">${r.q25_fake_timers_loss_of_trust} / 5</div></div>
                </div>
            </div>

            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 12px;">
                Recorded At: ${new Date(r.submitted_at).toISOString()} | UUID: ${r.response_uuid}
            </div>
        `;

        document.getElementById('responseModal').style.display = 'flex';

    } catch (err) {
        console.error('Failed to load response:', err);
    }
}

function closeModal() {
    document.getElementById('responseModal').style.display = 'none';
}

// Export Trigger
async function exportData(format) {
    if (!adminToken) return;
    try {
        const res = await fetch(`/api/admin/export/${format}?token=${encodeURIComponent(adminToken)}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!res.ok) {
            alert('Export request failed. Status: ' + res.status);
            return;
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = format === 'excel' ? 'xlsx' : 'csv';
        a.download = `MRP_Primary_Survey_Responses_Latest.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export download error:', err);
        window.open(`/api/admin/export/${format}?token=${encodeURIComponent(adminToken)}`, '_blank');
    }
}

// Trigger Manual Re-sync of Files
async function triggerServerSync() {
    if (!adminToken) return;
    try {
        const res = await fetch('/api/admin/refresh-exports', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const data = await res.json();
        if (data.success) {
            alert('SQLite responses successfully synchronized to data/raw_responses.xlsx and data/raw_responses.csv!');
        } else {
            alert('Sync failed: ' + data.error);
        }
    } catch (err) {
        alert('Network error triggering synchronization.');
    }
}

// ==============================================================================
// CRUD CONTROLLERS (Create, Update, Delete in SQLite)
// ==============================================================================

function openAddModal() {
    document.getElementById('crudEditId').value = '';
    document.getElementById('crudModalTitle').innerText = 'Add New Survey Response to SQLite';
    document.getElementById('btnSaveCrud').innerText = 'Save to Database';
    document.getElementById('crudForm').reset();
    document.getElementById('crud_q10').value = 4;
    document.getElementById('crud_q11').value = 4;
    document.getElementById('crud_q12').value = 3;
    document.getElementById('crud_q13').value = 3;
    document.getElementById('crud_q14').value = 5;
    document.getElementById('crud_q15').value = 4;
    document.getElementById('crud_q16').value = 4;
    document.getElementById('crud_q17').value = 5;
    document.getElementById('crud_q18').value = 4;
    document.getElementById('crud_q20').value = 5;
    document.getElementById('crud_q21').value = 4;
    document.getElementById('crud_q22').value = 4;
    document.getElementById('crud_q23').value = 4;
    document.getElementById('crud_q24').value = 3;
    document.getElementById('crud_q25').value = 5;
    document.getElementById('crudModal').style.display = 'flex';
}

async function openEditModal(respCode) {
    if (!adminToken) return;
    try {
        const res = await fetch(`/api/admin/responses/${respCode}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.response) {
            alert('Failed to load response data for editing.');
            return;
        }

        const r = data.response;
        document.getElementById('crudEditId').value = r.response_code;
        document.getElementById('crudModalTitle').innerText = `Edit Survey Response: ${r.response_code}`;
        document.getElementById('btnSaveCrud').innerText = 'Update in Database';

        document.getElementById('crud_full_name').value = r.name || r.full_name || '';
        document.getElementById('crud_age_group').value = r.age_group || '';
        document.getElementById('crud_gender').value = r.gender || '';
        document.getElementById('crud_city').value = r.city || '';
        document.getElementById('crud_state').value = r.state || '';
        document.getElementById('crud_occupation').value = r.occupation || '';
        document.getElementById('crud_income_group').value = r.income_group || '';
        document.getElementById('crud_preferred_channel').value = r.preferred_channel || 'Online';
        document.getElementById('crud_q07').value = r.q07_online_impulse_freq || '';
        document.getElementById('crud_q08').value = r.q08_offline_impulse_freq || '';
        document.getElementById('crud_q09').value = r.q09_avg_unplanned_spend || '';
        document.getElementById('crud_q19').value = r.q19_primary_payment_mode || '';

        document.getElementById('crud_q10').value = r.q10_need_for_touch || 3;
        document.getElementById('crud_q11').value = r.q11_visual_displays || 3;
        document.getElementById('crud_q12').value = r.q12_checkout_placement || 3;
        document.getElementById('crud_q13').value = r.q13_salesperson_advice || 3;
        document.getElementById('crud_q14').value = r.q14_ai_recommendations || 3;
        document.getElementById('crud_q15').value = r.q15_countdown_timers || 3;
        document.getElementById('crud_q16').value = r.q16_scarcity_fomo || 3;
        document.getElementById('crud_q17').value = r.q17_social_proof_reviews || 3;
        document.getElementById('crud_q18').value = r.q18_push_notifications || 3;
        document.getElementById('crud_q20').value = r.q20_upi_pain_reduction || 3;
        document.getElementById('crud_q21').value = r.q21_bnpl_spend_encouragement || 3;
        document.getElementById('crud_q22').value = r.q22_online_impulse_regret || 3;
        document.getElementById('crud_q23').value = r.q23_offline_satisfaction || 3;
        document.getElementById('crud_q24').value = r.q24_return_exchange_freq || 2;
        document.getElementById('crud_q25').value = r.q25_fake_timers_loss_of_trust || 4;

        document.getElementById('crudModal').style.display = 'flex';
    } catch (err) {
        console.error('Error fetching response to edit:', err);
    }
}

function closeCrudModal() {
    document.getElementById('crudModal').style.display = 'none';
}

async function handleCrudSubmit(e) {
    e.preventDefault();
    if (!adminToken) return;

    const editId = document.getElementById('crudEditId').value.trim();
    const isEdit = Boolean(editId);

    const payload = {
        name: document.getElementById('crud_full_name').value.trim(),
        full_name: document.getElementById('crud_full_name').value.trim(),
        age_group: document.getElementById('crud_age_group').value,
        gender: document.getElementById('crud_gender').value,
        city: document.getElementById('crud_city').value.trim(),
        state: document.getElementById('crud_state').value,
        occupation: document.getElementById('crud_occupation').value,
        income_group: document.getElementById('crud_income_group').value,
        preferred_channel: document.getElementById('crud_preferred_channel').value,
        q07_online_impulse_freq: document.getElementById('crud_q07').value,
        q08_offline_impulse_freq: document.getElementById('crud_q08').value,
        q09_avg_unplanned_spend: document.getElementById('crud_q09').value,
        q19_primary_payment_mode: document.getElementById('crud_q19').value,
        q10_need_for_touch: parseInt(document.getElementById('crud_q10').value, 10),
        q11_visual_displays: parseInt(document.getElementById('crud_q11').value, 10),
        q12_checkout_placement: parseInt(document.getElementById('crud_q12').value, 10),
        q13_salesperson_advice: parseInt(document.getElementById('crud_q13').value, 10),
        q14_ai_recommendations: parseInt(document.getElementById('crud_q14').value, 10),
        q15_countdown_timers: parseInt(document.getElementById('crud_q15').value, 10),
        q16_scarcity_fomo: parseInt(document.getElementById('crud_q16').value, 10),
        q17_social_proof_reviews: parseInt(document.getElementById('crud_q17').value, 10),
        q18_push_notifications: parseInt(document.getElementById('crud_q18').value, 10),
        q20_upi_pain_reduction: parseInt(document.getElementById('crud_q20').value, 10),
        q21_bnpl_spend_encouragement: parseInt(document.getElementById('crud_q21').value, 10),
        q22_online_impulse_regret: parseInt(document.getElementById('crud_q22').value, 10),
        q23_offline_satisfaction: parseInt(document.getElementById('crud_q23').value, 10),
        q24_return_exchange_freq: parseInt(document.getElementById('crud_q24').value, 10),
        q25_fake_timers_loss_of_trust: parseInt(document.getElementById('crud_q25').value, 10)
    };

    const url = isEdit ? `/api/admin/responses/${editId}` : '/api/admin/responses';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
            closeCrudModal();
            loadDashboardData(true);
            alert(isEdit ? `Response ${editId} successfully updated in SQLite and files synchronized!` : 'New response created and synchronized!');
        } else {
            alert('Failed to save response: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('CRUD submit error:', err);
        alert('Network error saving response to SQLite.');
    }
}

async function deleteResponse(respCode) {
    if (!adminToken) return;
    const ok = confirm(`Are you sure you want to permanently delete response ${respCode} from the SQLite database? This will update the dataset and Excel/CSV files.`);
    if (!ok) return;

    try {
        const res = await fetch(`/api/admin/responses/${respCode}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        const data = await res.json();
        if (res.ok && data.success) {
            loadDashboardData(true);
            alert(`Response ${respCode} deleted and exports updated.`);
        } else {
            alert('Failed to delete response: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Delete request error:', err);
        alert('Network error deleting response.');
    }
}
