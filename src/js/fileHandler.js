// File Handler - File upload + image paste handler
// FIX 2: attach button uses direct onclick + ipc invoke
// FIX 3: paste handler works with Ctrl+V for images
const FileHandler = {
  pendingFiles: [],

  init() {
    this.setupDragDrop();
    this.setupPaste();
    this.setupAttachButton();
  },

  setupDragDrop() {
    const overlay = document.getElementById('drop-overlay');
    const body = document.body;

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      overlay.classList.add('active');
    });

    body.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || !body.contains(e.relatedTarget)) {
        overlay.classList.remove('active');
      }
    });

    overlay.addEventListener('dragleave', () => overlay.classList.remove('active'));

    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      overlay.classList.remove('active');
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        await this.processDroppedFile(file);
      }
    });
  },

  // FIX 3: Robust paste handler — catches Ctrl+V images globally
  setupPaste() {
    document.addEventListener('paste', async (e) => {
      // Check clipboard for images
      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      let handled = false;

      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            await this.processImageBlob(blob);
            handled = true;
          }
        }
      }

      // Also check clipboardData.files as fallback
      if (!handled && clipboardData.files && clipboardData.files.length > 0) {
        for (const file of Array.from(clipboardData.files)) {
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            await this.processImageBlob(file);
          }
        }
      }
    });
  },

  // FIX 2: Attach button — bind via addEventListener AND provide direct call
  setupAttachButton() {
    const btn = document.getElementById('attach-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleAttachClick();
      });
    }
  },

  // FIX 2: Direct call for onclick attribute fallback
  async handleAttachClick() {
    try {
      const filePath = await window.avis.openFileDialog();
      if (filePath) {
        await this.processFilePath(filePath);
      }
    } catch (err) {
      console.error('File dialog error:', err);
      alert('Could not open file dialog: ' + err.message);
    }
  },

  // Hint for paste button
  triggerPasteHint() {
    const input = document.getElementById('chat-input');
    if (input) {
      input.focus();
      input.placeholder = 'Press Ctrl+V to paste an image...';
      setTimeout(() => { input.placeholder = 'Type your message... (search, navigate, run code, open files)'; }, 3000);
    }
  },

  async processDroppedFile(file) {
    if (file.size > 20 * 1024 * 1024) {
      alert('File exceeds 20MB limit: ' + file.name);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      if (!confirm(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB. Continue?`)) return;
    }

    if (file.path) {
      await this.processFilePath(file.path);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const isImage = file.type.startsWith('image/');
        this.pendingFiles.push({
          name: file.name,
          type: isImage ? 'image' : 'text',
          data: isImage ? reader.result.split(',')[1] : reader.result,
          mimeType: file.type || (isImage ? 'image/png' : 'text/plain'),
          sizeMB: file.size / (1024 * 1024)
        });
        this.updatePreview();
      };
      if (file.type.startsWith('image/')) reader.readAsDataURL(file);
      else reader.readAsText(file);
    }
  },

  async processFilePath(filePath) {
    try {
      const fileData = await window.avis.readFile(filePath);
      this.pendingFiles.push(fileData);
      this.updatePreview();
    } catch (err) {
      alert('Error reading file: ' + err.message);
    }
  },

  async processImageBlob(blob) {
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.pendingFiles.push({
        name: 'pasted-image.png',
        type: 'image',
        data: reader.result.split(',')[1],
        mimeType: blob.type || 'image/png',
        sizeMB: blob.size / (1024 * 1024)
      });
      this.updatePreview();
    };
    reader.onerror = () => {
      console.error('Failed to read pasted image');
    };
    reader.readAsDataURL(blob);
  },

  updatePreview() {
    const area = document.getElementById('file-preview-area');
    if (!area) return;
    area.innerHTML = '';
    this.pendingFiles.forEach((f, i) => {
      const el = document.createElement('div');
      el.className = 'file-attachment';
      const icon = f.type === 'image' ? '\uD83D\uDDBC\uFE0F' : '\uD83D\uDCC4';
      el.innerHTML = `${icon} ${f.name} (${f.sizeMB.toFixed(1)}MB) <span class="remove-file" onclick="FileHandler.removeFile(${i})">\u2715</span>`;
      area.appendChild(el);
    });
    area.style.display = this.pendingFiles.length > 0 ? 'flex' : 'none';
  },

  removeFile(index) {
    this.pendingFiles.splice(index, 1);
    this.updatePreview();
  },

  consumeFiles() {
    const files = [...this.pendingFiles];
    this.pendingFiles = [];
    this.updatePreview();
    return files;
  },

  hasFiles() {
    return this.pendingFiles.length > 0;
  }
};
