// clientManager.js — AVIS Client Platform Manager
// Manages client profiles, finances, spending, recommendations, and coaching context
// All client data lives in clients/[CODE]/ — no database, just JSON files

const ClientManager = {
  _clientsPath: null,
  _activeClient: null,
  _cachedProfile: null,
  _cachedFinances: null,

  // ================================================================
  // INITIALIZATION
  // ================================================================
  async init() {
    try {
      const avisPath = await window.avis.getAvisPath();
      this._clientsPath = avisPath.replace(/\\/g, '/') + '/clients';
    } catch (e) {
      this._clientsPath = null;
    }
    // Restore active client from electron-store
    const stored = await window.avis.storeGet('activeClient', null);
    if (stored) {
      this._activeClient = stored;
      await this._loadClientData();
    }
  },

  // ================================================================
  // CLIENT SWITCHING
  // ================================================================
  async setActiveClient(clientCode) {
    if (clientCode) {
      this._activeClient = clientCode;
      await window.avis.storeSet('activeClient', clientCode);
      await this._loadClientData();
    } else {
      this._activeClient = null;
      this._cachedProfile = null;
      this._cachedFinances = null;
      await window.avis.storeSet('activeClient', null);
    }
  },

  getActiveClient() {
    return this._activeClient;
  },

  isClientMode() {
    return !!this._activeClient;
  },

  // ================================================================
  // DATA ACCESS — always reads fresh from disk
  // ================================================================
  async _loadClientData() {
    if (!this._activeClient || !this._clientsPath) return;
    try {
      const profileRaw = await window.avis.toolReadFile(`${this._clientsPath}/${this._activeClient}/profile.json`);
      this._cachedProfile = JSON.parse(profileRaw);
      const finRaw = await window.avis.toolReadFile(`${this._clientsPath}/${this._activeClient}/finances.json`);
      this._cachedFinances = JSON.parse(finRaw);
    } catch (e) {
      console.warn('ClientManager: could not load client data:', e.message);
    }
  },

  async getProfile(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return null;
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/profile.json`);
      return JSON.parse(raw);
    } catch (e) { return null; }
  },

  async getFinances(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return null;
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/finances.json`);
      return JSON.parse(raw);
    } catch (e) { return null; }
  },

  async getSpendingLog(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return { entries: [] };
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/spending_log.json`);
      return JSON.parse(raw);
    } catch (e) { return { entries: [] }; }
  },

  async getProgressLog(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return { events: [] };
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/progress_log.json`);
      return JSON.parse(raw);
    } catch (e) { return { events: [] }; }
  },

  async getConversationLog(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return { messages: [] };
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/conversation_log.json`);
      return JSON.parse(raw);
    } catch (e) { return { messages: [] }; }
  },

  async getCoachingNotes(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return { notes: [] };
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/coaching_notes.json`);
      return JSON.parse(raw);
    } catch (e) { return { notes: [] }; }
  },

  async getRecommendations(clientCode, statusFilter) {
    const code = clientCode || this._activeClient;
    if (!code) return [];
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/recommendations.json`);
      const data = JSON.parse(raw);
      if (statusFilter) return data.recommendations.filter(r => r.status === statusFilter);
      return data.recommendations;
    } catch (e) { return []; }
  },

  // ================================================================
  // DATA WRITES
  // ================================================================
  async updateFinances(clientCode, updates) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const finances = await this.getFinances(code);
      Object.assign(finances, updates, { last_updated: new Date().toISOString().split('T')[0] });
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/finances.json`,
        JSON.stringify(finances, null, 2)
      );
      return true;
    } catch (e) { return false; }
  },

  async updateProfile(clientCode, updates) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const profile = await this.getProfile(code);
      Object.assign(profile, updates);
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/profile.json`,
        JSON.stringify(profile, null, 2)
      );
      return true;
    } catch (e) { return false; }
  },

  async logSpending(clientCode, entry) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const log = await this.getSpendingLog(code);
      const newEntry = {
        id: `sp_${Date.now()}`,
        date: entry.date || new Date().toISOString().split('T')[0],
        amount: parseFloat(entry.amount),
        category: entry.category,
        note: entry.note || '',
        logged_at: new Date().toISOString()
      };
      log.entries.push(newEntry);
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/spending_log.json`,
        JSON.stringify(log, null, 2)
      );
      // Also log to progress
      await this.logProgress(code, 'spending_logged', `$${newEntry.amount} on ${newEntry.category}`);
      return newEntry;
    } catch (e) { return false; }
  },

  async logProgress(clientCode, type, note) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const log = await this.getProgressLog(code);
      log.events.push({
        date: new Date().toISOString().split('T')[0],
        type,
        note,
        timestamp: new Date().toISOString()
      });
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/progress_log.json`,
        JSON.stringify(log, null, 2)
      );
      return true;
    } catch (e) { return false; }
  },

  async saveConversationMessage(clientCode, role, text) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const log = await this.getConversationLog(code);
      log.messages.push({
        role,
        text,
        timestamp: new Date().toISOString()
      });
      // Keep last 200 messages
      if (log.messages.length > 200) log.messages = log.messages.slice(-200);
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/conversation_log.json`,
        JSON.stringify(log, null, 2)
      );
      return true;
    } catch (e) { return false; }
  },

  async addCoachingNote(clientCode, note) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const notes = await this.getCoachingNotes(code);
      notes.notes.push({
        date: new Date().toISOString().split('T')[0],
        author: 'AVL-000',
        note
      });
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/coaching_notes.json`,
        JSON.stringify(notes, null, 2)
      );
      return true;
    } catch (e) { return false; }
  },

  // ================================================================
  // RECOMMENDATIONS PIPELINE
  // ================================================================
  async pushRecommendation(clientCode, rec) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const data = await this.getRecommendations(code);
      const allRecs = Array.isArray(data) ? data : [];
      const newRec = {
        id: `rec_${Date.now()}`,
        created_at: new Date().toISOString(),
        created_by: 'AVL-000',
        title: rec.title,
        body: rec.body,
        action_type: rec.action_type || 'informational',
        priority: rec.priority || 'medium',
        expires_at: rec.expires_at || null,
        status: 'pending',
        viewed_at: null,
        responded_at: null,
        response: null,
        follow_up_thread_id: null
      };
      allRecs.push(newRec);
      await window.avis.toolWriteFile(
        `${this._clientsPath}/${code}/recommendations.json`,
        JSON.stringify({ recommendations: allRecs }, null, 2)
      );
      return newRec;
    } catch (e) { return false; }
  },

  async markRecommendationViewed(clientCode, recId) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/recommendations.json`);
      const data = JSON.parse(raw);
      const rec = data.recommendations.find(r => r.id === recId);
      if (rec) {
        rec.viewed_at = new Date().toISOString();
        if (rec.status === 'pending') rec.status = 'viewed';
        await window.avis.toolWriteFile(
          `${this._clientsPath}/${code}/recommendations.json`,
          JSON.stringify(data, null, 2)
        );
      }
      return true;
    } catch (e) { return false; }
  },

  async respondToRecommendation(clientCode, recId, response) {
    const code = clientCode || this._activeClient;
    if (!code) return false;
    try {
      const raw = await window.avis.toolReadFile(`${this._clientsPath}/${code}/recommendations.json`);
      const data = JSON.parse(raw);
      const rec = data.recommendations.find(r => r.id === recId);
      if (rec) {
        rec.responded_at = new Date().toISOString();
        rec.response = response;
        rec.status = response === 'snoozed' ? 'snoozed' : 'completed';
        await window.avis.toolWriteFile(
          `${this._clientsPath}/${code}/recommendations.json`,
          JSON.stringify(data, null, 2)
        );
      }
      return true;
    } catch (e) { return false; }
  },

  // ================================================================
  // CALCULATIONS
  // ================================================================
  async getMonthSpending(clientCode) {
    const log = await this.getSpendingLog(clientCode);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEntries = log.entries.filter(e => e.date >= monthStart);

    const byCategory = {};
    let total = 0;
    for (const entry of monthEntries) {
      const cat = entry.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + entry.amount;
      total += entry.amount;
    }
    return { total, byCategory, entries: monthEntries };
  },

  async getWeekSpending(clientCode) {
    const log = await this.getSpendingLog(clientCode);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEntries = log.entries.filter(e => e.date >= weekStartStr);

    let total = 0;
    const byCategory = {};
    for (const entry of weekEntries) {
      const cat = entry.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + entry.amount;
      total += entry.amount;
    }
    return { total, byCategory, entries: weekEntries };
  },

  async getRemainingBudget(clientCode) {
    const finances = await this.getFinances(clientCode);
    const monthSpending = await this.getMonthSpending(clientCode);
    if (!finances) return null;

    const budget = finances.monthly_budget;
    const remaining = {};
    for (const [cat, limit] of Object.entries(budget)) {
      const spent = monthSpending.byCategory[cat] || 0;
      remaining[cat] = { limit, spent, remaining: limit - spent };
    }

    const totalBudget = Object.values(budget).reduce((s, v) => s + v, 0);
    remaining._total = { limit: totalBudget, spent: monthSpending.total, remaining: totalBudget - monthSpending.total };
    return remaining;
  },

  getPlanMonth(profile) {
    if (!profile || !profile.plan_start_date) return 1;
    const start = new Date(profile.plan_start_date);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
    return Math.max(1, Math.min(months, profile.plan_duration_months || 8));
  },

  getClientHealthScore(finances, monthSpending) {
    if (!finances) return 50;
    let score = 50;

    // Budget adherence (up to 30 points)
    const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);
    if (totalBudget > 0) {
      const ratio = monthSpending.total / totalBudget;
      if (ratio <= 0.8) score += 30;
      else if (ratio <= 1.0) score += 20;
      else if (ratio <= 1.2) score += 10;
      else score -= 10;
    }

    // Savings progress (up to 20 points)
    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    if (savings && savings.target_balance > 0) {
      const progress = savings.balance / savings.target_balance;
      score += Math.round(progress * 20);
    }

    return Math.max(0, Math.min(100, score));
  },

  // ================================================================
  // MULTI-CLIENT — cockpit functions
  // ================================================================
  async listClients() {
    if (!this._clientsPath) return [];
    try {
      const paths = await window.avis.storeGet('clientList', []);
      // Also scan directory via IPC
      return paths;
    } catch (e) { return []; }
  },

  async getAllClientsSummary() {
    const clients = await this.listClients();
    const summaries = [];
    for (const code of clients) {
      try {
        const profile = await this.getProfile(code);
        const finances = await this.getFinances(code);
        const monthSpending = await this.getMonthSpending(code);
        const pending = await this.getRecommendations(code, 'pending');

        summaries.push({
          code,
          name: profile?.display_name || code,
          status: profile?.status || 'unknown',
          theme: profile?.theme?.id || 'default',
          themeColors: profile?.theme ? { primary: profile.theme.color_primary, accent: profile.theme.color_accent } : null,
          spending: monthSpending.total,
          budget: finances ? Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0) : 0,
          savingsBalance: finances?.accounts?.find(a => a.purpose === 'house_savings')?.balance || 0,
          savingsTarget: finances?.accounts?.find(a => a.purpose === 'house_savings')?.target_balance || 0,
          pendingRecs: pending.length,
          healthScore: this.getClientHealthScore(finances, monthSpending)
        });
      } catch (e) {
        summaries.push({ code, name: code, status: 'error', error: e.message });
      }
    }
    return summaries;
  },

  async registerClient(clientCode) {
    const list = await window.avis.storeGet('clientList', []);
    if (!list.includes(clientCode)) {
      list.push(clientCode);
      await window.avis.storeSet('clientList', list);
    }
  },

  async getAlerts(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return [];
    const alerts = [];

    try {
      const finances = await this.getFinances(code);
      const monthSpending = await this.getMonthSpending(code);
      const profile = await this.getProfile(code);
      const spendingLog = await this.getSpendingLog(code);

      // Budget overrun
      const totalBudget = finances ? Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0) : 0;
      if (totalBudget > 0 && monthSpending.total > totalBudget) {
        alerts.push({ type: 'budget_overrun', severity: 'high', message: `Over budget by $${(monthSpending.total - totalBudget).toFixed(2)}` });
      }

      // Category overruns
      if (finances) {
        for (const [cat, limit] of Object.entries(finances.monthly_budget)) {
          const spent = monthSpending.byCategory[cat] || 0;
          if (limit > 0 && spent > limit * 1.5) {
            alerts.push({ type: 'category_overrun', severity: 'medium', message: `${cat} spending at ${Math.round(spent/limit*100)}% of budget` });
          }
        }
      }

      // Inactivity
      if (spendingLog.entries.length > 0) {
        const lastEntry = spendingLog.entries[spendingLog.entries.length - 1];
        const daysSince = Math.floor((Date.now() - new Date(lastEntry.logged_at || lastEntry.date).getTime()) / 86400000);
        if (daysSince >= 5) {
          alerts.push({ type: 'inactivity', severity: 'low', message: `No spending logged in ${daysSince} days` });
        }
      }

      // Goal at risk
      if (finances) {
        const savings = finances.accounts.find(a => a.purpose === 'house_savings');
        if (savings && savings.target_balance && savings.target_date) {
          const monthsLeft = Math.max(1, (new Date(savings.target_date) - new Date()) / (30 * 86400000));
          const needed = savings.target_balance - savings.balance;
          const monthlyNeeded = needed / monthsLeft;
          if (monthlyNeeded > (profile?.income?.base_pay_monthly || 1440) * 0.3) {
            alerts.push({ type: 'goal_at_risk', severity: 'high', message: `Need $${monthlyNeeded.toFixed(0)}/month to hit savings goal — may be aggressive` });
          }
        }
      }
    } catch (e) {}

    return alerts;
  },

  // ================================================================
  // SYSTEM PROMPT BUILDER — rebuilds fresh on every call
  // ================================================================
  async buildClientSystemPrompt(clientCode) {
    const code = clientCode || this._activeClient;
    if (!code) return null;

    const profile = await this.getProfile(code);
    const finances = await this.getFinances(code);
    const spendingLog = await this.getSpendingLog(code);
    const monthSpending = await this.getMonthSpending(code);
    const remaining = await this.getRemainingBudget(code);

    if (!profile || !finances) return null;

    const planMonth = this.getPlanMonth(profile);
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();

    // Last 5 spending entries
    const recentEntries = spendingLog.entries.slice(-5);
    const recentFormatted = recentEntries.length > 0
      ? recentEntries.map(e => `- ${e.date}: $${e.amount.toFixed(2)} on ${e.category}${e.note ? ` (${e.note})` : ''}`).join('\n')
      : '(No spending logged yet)';

    // Budget remaining by category
    const budgetLines = remaining ? Object.entries(remaining)
      .filter(([k]) => k !== '_total')
      .map(([cat, data]) => `- ${cat}: $${data.spent.toFixed(2)} / $${data.limit} (${data.remaining >= 0 ? '$' + data.remaining.toFixed(2) + ' left' : '$' + Math.abs(data.remaining).toFixed(2) + ' OVER'})`)
      .join('\n') : '';

    // Savings account balance
    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    const savingsBalance = savings ? savings.balance : 0;
    const savingsTarget = savings ? savings.target_balance : 2100;

    // Pending recommendations
    const pendingRecs = await this.getRecommendations(code, 'pending');

    // Month priority based on plan month
    let monthPriority = 'Build emergency buffer and cut subscriptions';
    if (planMonth >= 2 && planMonth <= 4) monthPriority = 'Attack credit card debt aggressively';
    if (planMonth >= 5 && planMonth <= 6) monthPriority = 'Credit card should be paid off — maximize savings transfers';
    if (planMonth >= 7) monthPriority = 'Final push — every dollar to savings';

    return `You are ${profile.display_name}'s personal financial coach inside AVIS. You are warm, direct, supportive, and never preachy. You talk to ${profile.display_name} like a trusted friend who also happens to be really good with money.

CLIENT: ${profile.client_code} (${profile.display_name})
RELATIONSHIP: ${profile.relationship_to_operator === 'girlfriend' ? 'Girlfriend of operator (Avel/AVL-000), building toward home purchase together December 2026.' : profile.relationship_to_operator}

HER FINANCIAL PROFILE:
- Monthly income: $${profile.income.base_pay_monthly.toLocaleString()} base pay
- Lives with Avel (no rent)
- Health insurance: covered by ${profile.demographics.insurance_covered_by}
- Food budget: $${finances.monthly_budget.food}/month
- Subscriptions target: $${finances.monthly_budget.subscriptions}/month

CURRENT DEBTS:
${finances.debts.map(d => `- ${d.name}: $${d.balance.toFixed(2)} balance, $${d.minimum_payment}/month${d.status === 'auto_grinding' ? ' (auto-pay)' : ''}`).join('\n')}
- Phone: PAID OFF ✅

ACCOUNTS:
- Wealthfront Cash: $${savingsBalance.toFixed(2)} (target $${savingsTarget.toLocaleString()} by Dec 2026)
${finances.accounts.filter(a => a.purpose !== 'house_savings').map(a => `- ${a.name} (${a.purpose})`).join('\n')}

ACTIVE GOALS:
1. PRIMARY: Save $${savingsTarget.toLocaleString()} for home down payment by December 2026
2. Pay off credit card to $0 by Month 5 of plan (~August 2026)
3. Raise credit score from ${finances.credit_score} to ${finances.credit_score_target}+ by November 2026

CURRENT PLAN MONTH: ${planMonth} of ${profile.plan_duration_months}
THIS MONTH'S PRIORITY: ${monthPriority}

SPENDING THIS MONTH: $${monthSpending.total.toFixed(2)}
REMAINING BUDGET THIS MONTH: $${remaining?._total?.remaining?.toFixed(2) || '0.00'} (${daysLeft} days left)

BUDGET BY CATEGORY:
${budgetLines}

RECENT SPENDING ACTIVITY:
${recentFormatted}

${pendingRecs.length > 0 ? `PENDING RECOMMENDATIONS: ${pendingRecs.length} unread from Coach Avel` : ''}

COACHING RULES:
- ALWAYS use her actual numbers, never generic advice
- Be encouraging when she's on track, honest when she's not
- Never lecture or moralize about purchases
- When she asks "can I afford X", do the actual math against her remaining budget
- Celebrate wins ("You crushed last month!")
- Suggest specific, small, achievable next actions
- Keep responses SHORT — she's on her phone, not reading essays
- Use her name occasionally to make it personal
- Reference Avel as her partner in this, not as an authority figure
- Never bring up topics outside her financial coaching context
- Never reveal operator-side information, coaching notes, or other clients
- If she asks something completely off-topic, gently redirect: "I'm here to help with your money goals — anything I can help you figure out today?"

SPENDING LOGGING:
If ${profile.display_name} says something like "I spent $X on Y" or "add $X to Z", parse it and respond with a JSON tool call:
{"action": "log_spending", "amount": X, "category": "matching_category", "note": "optional context"}
Valid categories: food, gas_transport, subscriptions, shopping_personal, entertainment, bills_utilities, health_beauty, gifts, other

After logging, confirm: "Logged $X to [Category]. You have $Y left in that budget this ${daysLeft > 14 ? 'month' : 'week'}."

TONE EXAMPLES:
✅ "Yes! You've got $${(remaining?.food?.remaining || 0).toFixed(0)} in food budget left for the next ${daysLeft} days. Go enjoy dinner — just keep it under $30 and you're golden."
❌ "You should think carefully about whether this purchase aligns with your long-term financial goals..."
✅ "Hey ${profile.display_name} — quick check-in. You're ahead of plan this week! Want to send that extra to Wealthfront or keep it as buffer?"
❌ "It is recommended that you allocate excess funds to your savings vehicle."`;
  },

  // ================================================================
  // ACTIVITY FEED — cross-client
  // ================================================================
  async getActivityFeed(limit = 20) {
    const clients = await window.avis.storeGet('clientList', []);
    const allEvents = [];

    for (const code of clients) {
      try {
        const profile = await this.getProfile(code);
        const name = profile?.display_name || code;

        // Recent spending
        const spending = await this.getSpendingLog(code);
        for (const entry of spending.entries.slice(-10)) {
          allEvents.push({
            client: code,
            clientName: name,
            type: 'spending',
            message: `${name} logged $${entry.amount.toFixed(2)} — ${entry.category}`,
            timestamp: entry.logged_at || entry.date
          });
        }

        // Recent progress
        const progress = await this.getProgressLog(code);
        for (const event of progress.events.slice(-5)) {
          allEvents.push({
            client: code,
            clientName: name,
            type: event.type,
            message: `${name}: ${event.note}`,
            timestamp: event.timestamp || event.date
          });
        }
      } catch (e) {}
    }

    // Sort by timestamp descending
    allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return allEvents.slice(0, limit);
  }
};
