// themeManager.js — Per-client theme engine for AVIS Client Platform
// Loads theme from client profile, injects CSS variables, manages mascot/patterns/sounds

const ThemeManager = {
  _currentTheme: null,
  _styleEl: null,

  // ================================================================
  // THEME PRESETS
  // ================================================================
  PRESETS: {
    'pink-kitty': {
      id: 'pink-kitty',
      name: 'Pink Kitty',
      color_primary: '#ff69b4',
      color_secondary: '#ffb6d5',
      color_accent: '#ff1493',
      color_background: '#fff0f7',
      color_card: '#ffffff',
      color_text_primary: '#3d1f2e',
      color_text_secondary: '#7a4458',
      color_success: '#ff77aa',
      color_warning: '#ffa500',
      color_danger: '#dc143c',
      font_heading: 'Quicksand',
      font_body: 'Nunito',
      border_radius: '20px',
      mascot: 'kitty',
      mascot_position: 'top_right',
      background_pattern: 'kitty_hearts',
      button_style: 'rounded_soft',
      icon_style: 'cute_filled',
      animation_style: 'bouncy',
      sound_effects: true,
      confetti_color: 'pink'
    },
    'niyatori-luxe': {
      id: 'niyatori-luxe',
      name: 'Niyatori Luxe',
      color_primary: '#c8a96e',
      color_secondary: '#1a1a1f',
      color_accent: '#d4af37',
      color_background: '#0a0a0c',
      color_card: '#161618',
      color_text_primary: '#e8e4dc',
      color_text_secondary: '#8a8478',
      color_success: '#7fba5c',
      color_warning: '#d4a537',
      color_danger: '#c45c5c',
      font_heading: 'Fraunces',
      font_body: 'DM Sans',
      border_radius: '8px',
      mascot: null,
      background_pattern: 'geometric',
      button_style: 'sharp',
      icon_style: 'minimal_line',
      animation_style: 'smooth',
      sound_effects: false,
      confetti_color: 'gold'
    },
    'corporate-clean': {
      id: 'corporate-clean',
      name: 'Corporate Clean',
      color_primary: '#1e3a5f',
      color_secondary: '#f5f7fa',
      color_accent: '#2c6fbb',
      color_background: '#ffffff',
      color_card: '#f8f9fb',
      color_text_primary: '#1a1a2e',
      color_text_secondary: '#6b7280',
      color_success: '#10b981',
      color_warning: '#f59e0b',
      color_danger: '#ef4444',
      font_heading: 'Inter',
      font_body: 'Inter',
      border_radius: '6px',
      mascot: null,
      background_pattern: 'grid',
      button_style: 'square',
      icon_style: 'outline',
      animation_style: 'minimal',
      sound_effects: false,
      confetti_color: 'blue'
    },
    'sunset-coach': {
      id: 'sunset-coach',
      name: 'Sunset Coach',
      color_primary: '#ff6b35',
      color_secondary: '#ffd4c0',
      color_accent: '#ff8c61',
      color_background: '#fff5f0',
      color_card: '#ffffff',
      color_text_primary: '#2d1810',
      color_text_secondary: '#7a5c50',
      color_success: '#4ade80',
      color_warning: '#fbbf24',
      color_danger: '#f87171',
      font_heading: 'Poppins',
      font_body: 'Poppins',
      border_radius: '16px',
      mascot: 'sun',
      background_pattern: 'gradient',
      button_style: 'pill',
      icon_style: 'filled',
      animation_style: 'smooth',
      sound_effects: true,
      confetti_color: 'orange'
    },
    'forest-calm': {
      id: 'forest-calm',
      name: 'Forest Calm',
      color_primary: '#6b8f71',
      color_secondary: '#e8ede4',
      color_accent: '#4a7c59',
      color_background: '#faf8f5',
      color_card: '#ffffff',
      color_text_primary: '#2c3e2d',
      color_text_secondary: '#6b7c6b',
      color_success: '#48bb78',
      color_warning: '#ecc94b',
      color_danger: '#e53e3e',
      font_heading: 'Lora',
      font_body: 'Karla',
      border_radius: '12px',
      mascot: 'leaf',
      background_pattern: 'organic',
      button_style: 'soft',
      icon_style: 'hand_drawn',
      animation_style: 'slow',
      sound_effects: true,
      confetti_color: 'green'
    },
    'cyber-goal': {
      id: 'cyber-goal',
      name: 'Cyber Goal',
      color_primary: '#a855f7',
      color_secondary: '#1a1025',
      color_accent: '#c084fc',
      color_background: '#0d0614',
      color_card: '#1a1025',
      color_text_primary: '#e8dff5',
      color_text_secondary: '#8b7fa8',
      color_success: '#22d3ee',
      color_warning: '#f59e0b',
      color_danger: '#f43f5e',
      font_heading: 'Space Grotesk',
      font_body: 'Space Grotesk',
      border_radius: '4px',
      mascot: 'robot',
      background_pattern: 'grid',
      button_style: 'beveled',
      icon_style: 'tech',
      animation_style: 'snappy',
      sound_effects: true,
      confetti_color: 'purple'
    }
  },

  // ================================================================
  // THEME APPLICATION
  // ================================================================
  applyTheme(theme) {
    this._currentTheme = theme;

    // Create or reuse style element
    if (!this._styleEl) {
      this._styleEl = document.createElement('style');
      this._styleEl.id = 'client-theme-vars';
      document.head.appendChild(this._styleEl);
    }

    // Load Google Fonts
    this._loadFonts(theme.font_heading, theme.font_body);

    // Set CSS variables
    this._styleEl.textContent = `
      :root, .client-mode {
        --client-primary: ${theme.color_primary};
        --client-secondary: ${theme.color_secondary};
        --client-accent: ${theme.color_accent};
        --client-bg: ${theme.color_background};
        --client-card: ${theme.color_card};
        --client-text: ${theme.color_text_primary};
        --client-text-secondary: ${theme.color_text_secondary};
        --client-success: ${theme.color_success};
        --client-warning: ${theme.color_warning};
        --client-danger: ${theme.color_danger};
        --client-font-heading: '${theme.font_heading}', sans-serif;
        --client-font-body: '${theme.font_body}', sans-serif;
        --client-radius: ${theme.border_radius};
        --client-confetti: ${theme.confetti_color};
      }
    `;
  },

  resetTheme() {
    this._currentTheme = null;
    if (this._styleEl) {
      this._styleEl.textContent = '';
    }
    document.body.classList.remove('client-mode');
  },

  getTheme() {
    return this._currentTheme;
  },

  getPreset(presetId) {
    return this.PRESETS[presetId] || null;
  },

  getPresetList() {
    return Object.values(this.PRESETS).map(p => ({ id: p.id, name: p.name, primary: p.color_primary, accent: p.color_accent }));
  },

  // ================================================================
  // MASCOT
  // ================================================================
  getMascotSVG(theme) {
    if (!theme || !theme.mascot) return '';
    const mascots = {
      kitty: this._kittyMascotSVG(),
      sun: '<svg viewBox="0 0 80 80" width="60"><circle cx="40" cy="40" r="25" fill="#ff6b35"/><circle cx="32" cy="35" r="3" fill="#fff"/><circle cx="48" cy="35" r="3" fill="#fff"/><path d="M30 48 Q40 56 50 48" stroke="#fff" fill="none" stroke-width="2.5"/><g stroke="#ff6b35" stroke-width="3"><line x1="40" y1="5" x2="40" y2="12"/><line x1="40" y1="68" x2="40" y2="75"/><line x1="5" y1="40" x2="12" y2="40"/><line x1="68" y1="40" x2="75" y2="40"/><line x1="14" y1="14" x2="19" y2="19"/><line x1="61" y1="61" x2="66" y2="66"/><line x1="66" y1="14" x2="61" y2="19"/><line x1="19" y1="61" x2="14" y2="66"/></g></svg>',
      leaf: '<svg viewBox="0 0 60 60" width="50"><path d="M30 8 Q50 20 45 40 Q35 55 30 55 Q25 55 15 40 Q10 20 30 8Z" fill="#6b8f71"/><line x1="30" y1="20" x2="30" y2="50" stroke="#4a7c59" stroke-width="1.5"/><path d="M30 28 Q22 22 18 28" stroke="#4a7c59" fill="none" stroke-width="1"/><path d="M30 36 Q38 30 42 36" stroke="#4a7c59" fill="none" stroke-width="1"/></svg>',
      robot: '<svg viewBox="0 0 60 60" width="50"><rect x="15" y="20" width="30" height="25" rx="4" fill="#a855f7"/><rect x="20" y="10" width="20" height="14" rx="4" fill="#c084fc"/><circle cx="26" cy="17" r="3" fill="#22d3ee"/><circle cx="34" cy="17" r="3" fill="#22d3ee"/><rect x="28" y="6" width="4" height="6" rx="2" fill="#c084fc"/><circle cx="30" cy="4" r="3" fill="#22d3ee"/><rect x="8" y="26" width="8" height="4" rx="2" fill="#a855f7"/><rect x="44" y="26" width="8" height="4" rx="2" fill="#a855f7"/><rect x="20" y="45" width="8" height="8" rx="2" fill="#a855f7"/><rect x="32" y="45" width="8" height="8" rx="2" fill="#a855f7"/></svg>'
    };
    return mascots[theme.mascot] || '';
  },

  _kittyMascotSVG() {
    return `<svg viewBox="0 0 120 120" width="80" class="mascot-kitty">
      <!-- Body -->
      <ellipse cx="60" cy="75" rx="35" ry="30" fill="#fff" stroke="#ff69b4" stroke-width="2"/>
      <!-- Head -->
      <circle cx="60" cy="40" r="28" fill="#fff" stroke="#ff69b4" stroke-width="2"/>
      <!-- Ears -->
      <path d="M38 18 L32 2 L48 14Z" fill="#fff" stroke="#ff69b4" stroke-width="2"/>
      <path d="M82 18 L88 2 L72 14Z" fill="#fff" stroke="#ff69b4" stroke-width="2"/>
      <path d="M40 17 L36 6 L47 15Z" fill="#ffb6d5"/>
      <path d="M80 17 L84 6 L73 15Z" fill="#ffb6d5"/>
      <!-- Eyes -->
      <ellipse cx="48" cy="38" rx="5" ry="6" fill="#3d1f2e"/>
      <ellipse cx="72" cy="38" rx="5" ry="6" fill="#3d1f2e"/>
      <circle cx="46" cy="36" r="2" fill="#fff"/>
      <circle cx="70" cy="36" r="2" fill="#fff"/>
      <!-- Nose -->
      <ellipse cx="60" cy="46" rx="3" ry="2" fill="#ff69b4"/>
      <!-- Mouth -->
      <path d="M55 49 Q60 54 65 49" stroke="#ff69b4" fill="none" stroke-width="1.5"/>
      <!-- Whiskers -->
      <line x1="30" y1="42" x2="44" y2="44" stroke="#ffb6d5" stroke-width="1"/>
      <line x1="30" y1="48" x2="44" y2="48" stroke="#ffb6d5" stroke-width="1"/>
      <line x1="76" y1="44" x2="90" y2="42" stroke="#ffb6d5" stroke-width="1"/>
      <line x1="76" y1="48" x2="90" y2="48" stroke="#ffb6d5" stroke-width="1"/>
      <!-- Bow -->
      <circle cx="82" cy="22" r="4" fill="#ff1493"/>
      <path d="M74 18 Q82 22 82 14 Q82 22 90 18 Q82 22 82 30 Q82 22 74 18Z" fill="#ff1493"/>
      <!-- Paws -->
      <ellipse cx="40" cy="98" rx="10" ry="6" fill="#fff" stroke="#ff69b4" stroke-width="1.5"/>
      <ellipse cx="80" cy="98" rx="10" ry="6" fill="#fff" stroke="#ff69b4" stroke-width="1.5"/>
      <!-- Sparkles -->
      <text x="95" y="15" font-size="12" fill="#ff69b4">✨</text>
      <text x="15" y="65" font-size="10" fill="#ffb6d5">💕</text>
    </svg>`;
  },

  // ================================================================
  // BACKGROUND PATTERN
  // ================================================================
  getBackgroundCSS(theme) {
    if (!theme) return '';
    const patterns = {
      kitty_hearts: `url("data:image/svg+xml,${encodeURIComponent(this._kittyHeartsPattern())}")`,
      geometric: `url("data:image/svg+xml,${encodeURIComponent('<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M0 20h40M20 0v40" stroke="rgba(200,169,110,0.06)" stroke-width="0.5"/></svg>')}")`,
      grid: `url("data:image/svg+xml,${encodeURIComponent('<svg width="30" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="30" height="30" fill="none" stroke="rgba(100,100,150,0.05)" stroke-width="0.5"/></svg>')}")`,
      gradient: 'linear-gradient(135deg, rgba(255,107,53,0.03) 0%, rgba(255,140,97,0.03) 100%)',
      organic: `url("data:image/svg+xml,${encodeURIComponent('<svg width="60" height="60" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="1.5" fill="rgba(107,143,113,0.08)"/><circle cx="10" cy="10" r="1" fill="rgba(107,143,113,0.06)"/><circle cx="50" cy="50" r="1" fill="rgba(107,143,113,0.06)"/></svg>')}")`
    };
    return patterns[theme.background_pattern] || '';
  },

  _kittyHeartsPattern() {
    return `<svg width="80" height="80" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 18 C20 14 15 12 13 15 C11 12 6 14 6 18 C6 23 13 27 13 27 C13 27 20 23 20 18Z" fill="rgba(255,105,180,0.04)"/>
      <path d="M60 50 C60 47 57 46 55 48 C53 46 50 47 50 50 C50 53 55 56 55 56 C55 56 60 53 60 50Z" fill="rgba(255,105,180,0.03)"/>
      <ellipse cx="45" cy="15" rx="4" ry="3.5" fill="rgba(255,182,213,0.03)"/>
      <path d="M44 11 L43 7 L46 10Z" fill="rgba(255,182,213,0.03)"/>
      <path d="M48 11 L49 7 L46 10Z" fill="rgba(255,182,213,0.03)"/>
    </svg>`;
  },

  // ================================================================
  // CONFETTI CONFIG
  // ================================================================
  getConfettiConfig(theme) {
    const colorSets = {
      pink: ['#ff69b4', '#ffb6d5', '#ff1493', '#ff77aa', '#fff0f7'],
      gold: ['#c8a96e', '#d4af37', '#b8960c', '#e8d5a0', '#fff4d6'],
      blue: ['#2c6fbb', '#1e3a5f', '#6ba3d6', '#a3c4e0', '#dbeafe'],
      orange: ['#ff6b35', '#ff8c61', '#ffd4c0', '#ffa07a', '#fff5f0'],
      green: ['#6b8f71', '#4a7c59', '#48bb78', '#a8d8b0', '#e8ede4'],
      purple: ['#a855f7', '#c084fc', '#22d3ee', '#8b5cf6', '#ddd6fe']
    };
    return {
      particleCount: 60,
      spread: 80,
      colors: colorSets[theme?.confetti_color] || colorSets.pink,
      duration: 2000
    };
  },

  // ================================================================
  // CATEGORY ICONS — returns inline SVG for spending categories
  // ================================================================
  getCategoryIcon(category, theme) {
    const color = theme?.color_primary || '#ff69b4';
    const icons = {
      food: `<svg viewBox="0 0 32 32" width="24"><circle cx="16" cy="20" r="10" fill="${color}" opacity="0.15"/><path d="M10 22 Q16 12 22 22Z" fill="${color}" opacity="0.3"/><ellipse cx="16" cy="22" rx="10" ry="4" fill="none" stroke="${color}" stroke-width="1.5"/><path d="M13 14 Q13 10 16 10 Q19 10 19 14" stroke="${color}" fill="none" stroke-width="1.5"/><path d="M14 12 C14 8 18 8 18 12" stroke="${color}" fill="none" stroke-width="1" opacity="0.5"/></svg>`,
      gas_transport: `<svg viewBox="0 0 32 32" width="24"><rect x="6" y="14" width="20" height="10" rx="4" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><circle cx="11" cy="24" r="2.5" fill="${color}" opacity="0.3" stroke="${color}" stroke-width="1"/><circle cx="21" cy="24" r="2.5" fill="${color}" opacity="0.3" stroke="${color}" stroke-width="1"/><rect x="9" y="16" width="5" height="4" rx="1" fill="${color}" opacity="0.2"/><rect x="18" y="16" width="5" height="4" rx="1" fill="${color}" opacity="0.2"/></svg>`,
      subscriptions: `<svg viewBox="0 0 32 32" width="24"><rect x="6" y="8" width="20" height="16" rx="3" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><path d="M6 12 L16 18 L26 12" stroke="${color}" fill="none" stroke-width="1.5"/><path d="M16 18 C16 14 12 13 12 16 C12 13 8 14 8 18 C8 22 12 24 12 24 C12 24 16 22 16 18Z" fill="${color}" opacity="0.3" transform="translate(4,-4) scale(0.7)"/></svg>`,
      shopping_personal: `<svg viewBox="0 0 32 32" width="24"><path d="M8 12 L6 26 Q6 28 8 28 L24 28 Q26 28 26 26 L24 12Z" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><path d="M12 12 C12 8 16 6 16 6 C16 6 20 8 20 12" stroke="${color}" fill="none" stroke-width="1.5"/></svg>`,
      entertainment: `<svg viewBox="0 0 32 32" width="24"><rect x="8" y="10" width="16" height="14" rx="3" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><circle cx="12" cy="8" r="3" fill="${color}" opacity="0.2"/><circle cx="20" cy="8" r="3" fill="${color}" opacity="0.2"/><rect x="10" y="5" width="12" height="3" fill="${color}" opacity="0.15"/><path d="M14 15 L14 21 L20 18Z" fill="${color}" opacity="0.4"/></svg>`,
      bills_utilities: `<svg viewBox="0 0 32 32" width="24"><rect x="8" y="6" width="16" height="22" rx="2" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><line x1="11" y1="12" x2="21" y2="12" stroke="${color}" stroke-width="1" opacity="0.4"/><line x1="11" y1="16" x2="21" y2="16" stroke="${color}" stroke-width="1" opacity="0.4"/><line x1="11" y1="20" x2="17" y2="20" stroke="${color}" stroke-width="1" opacity="0.4"/><path d="M18 22 Q20 20 22 22" stroke="${color}" fill="none" stroke-width="1.5"/></svg>`,
      health_beauty: `<svg viewBox="0 0 32 32" width="24"><circle cx="16" cy="16" r="10" fill="${color}" opacity="0.1"/><path d="M16 8 Q20 10 20 14 Q20 18 16 20 Q12 18 12 14 Q12 10 16 8Z" fill="${color}" opacity="0.25" stroke="${color}" stroke-width="1"/><circle cx="16" cy="14" r="2" fill="${color}" opacity="0.4"/><path d="M14 20 L14 26" stroke="${color}" stroke-width="1.5"/><path d="M18 20 L18 26" stroke="${color}" stroke-width="1.5"/></svg>`,
      gifts: `<svg viewBox="0 0 32 32" width="24"><rect x="7" y="14" width="18" height="12" rx="2" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><rect x="5" y="11" width="22" height="5" rx="2" fill="${color}" opacity="0.2" stroke="${color}" stroke-width="1.5"/><line x1="16" y1="11" x2="16" y2="26" stroke="${color}" stroke-width="1.5"/><path d="M16 11 Q12 6 10 8 Q8 10 12 12" stroke="${color}" fill="none" stroke-width="1.5"/><path d="M16 11 Q20 6 22 8 Q24 10 20 12" stroke="${color}" fill="none" stroke-width="1.5"/></svg>`,
      other: `<svg viewBox="0 0 32 32" width="24"><circle cx="16" cy="16" r="10" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/><text x="16" y="21" text-anchor="middle" font-size="14" fill="${color}" font-family="sans-serif">?</text></svg>`
    };
    return icons[category] || icons.other;
  },

  // ================================================================
  // SOUND EFFECTS
  // ================================================================
  playSoundEffect(theme, eventType) {
    if (!theme?.sound_effects) return;
    // Use Web Audio API for simple tones (no external files needed)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.08;

      const sounds = {
        log_spending: { freq: 880, type: 'sine', duration: 0.15 },
        goal_progress: { freq: 1200, type: 'sine', duration: 0.3 },
        under_budget: { freq: 660, type: 'triangle', duration: 0.2 },
        over_budget: { freq: 330, type: 'sawtooth', duration: 0.3 },
        coach_message: { freq: 520, type: 'sine', duration: 0.1 },
        success: { freq: 1046, type: 'sine', duration: 0.25 },
        notification: { freq: 740, type: 'sine', duration: 0.15 }
      };

      const sound = sounds[eventType] || sounds.notification;
      osc.frequency.value = sound.freq;
      osc.type = sound.type;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sound.duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + sound.duration);
    } catch (e) {}
  },

  // ================================================================
  // FONT LOADING
  // ================================================================
  _loadedFonts: new Set(),

  _loadFonts(...fontNames) {
    for (const font of fontNames) {
      if (!font || this._loadedFonts.has(font)) continue;
      // Skip system fonts
      if (['Inter', 'system-ui', 'sans-serif'].includes(font)) continue;
      this._loadedFonts.add(font);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@300;400;500;600;700&display=swap`;
      document.head.appendChild(link);
    }
  },

  // ================================================================
  // SIMPLE CONFETTI BURST
  // ================================================================
  burst(theme, x, y) {
    const config = this.getConfettiConfig(theme);
    const container = document.createElement('div');
    container.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:99999;`;
    document.body.appendChild(container);

    for (let i = 0; i < config.particleCount; i++) {
      const p = document.createElement('div');
      const color = config.colors[Math.floor(Math.random() * config.colors.length)];
      const size = 4 + Math.random() * 6;
      const angle = (Math.random() * 360) * Math.PI / 180;
      const velocity = 80 + Math.random() * 120;
      const dx = Math.cos(angle) * velocity;
      const dy = Math.sin(angle) * velocity - 60;

      p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random()>0.5?'50%':'2px'};`;
      container.appendChild(p);

      if (typeof gsap !== 'undefined') {
        gsap.to(p, {
          x: dx, y: dy, opacity: 0, rotation: Math.random() * 720,
          duration: 0.8 + Math.random() * 0.6,
          ease: 'power2.out'
        });
      }
    }

    setTimeout(() => container.remove(), config.duration);
  }
};
