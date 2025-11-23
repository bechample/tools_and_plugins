(() => {
  let isRunning = false;
  let prompts = [];
  let currentIndex = 0;

  // ---------- UI PANEL ----------

  function createPanel() {
    if (document.getElementById("pp-multi-prompt-panel")) return;

    const panel = document.createElement("div");
    panel.id = "pp-multi-prompt-panel";

    Object.assign(panel.style, {
      position: "fixed",
      top: "80px",
      right: "20px",
      width: "320px",
      maxHeight: "60vh",
      zIndex: "999999",
      background: "rgba(15,15,15,0.97)",
      color: "#fff",
      borderRadius: "10px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "13px",
      padding: "10px",
      display: "flex",
      flexDirection: "column",
      gap: "6px"
    });

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div>
          <div style="font-weight:600;font-size:13px;">Perplexity Prompt Queue</div>
          <div style="font-size:11px;opacity:0.7;">One prompt per line • Alt+P to toggle</div>
        </div>
        <button id="pp-toggle-panel"
          style="border:none;background:transparent;color:#ccc;cursor:pointer;font-size:14px;">
          ✕
        </button>
      </div>
      <textarea id="pp-prompt-input"
        placeholder="Enter one prompt per line..."
        style="width:100%;flex:1;min-height:120px;max-height:260px;resize:vertical;margin-top:4px;padding:6px;border-radius:6px;border:1px solid #444;background:#111;color:#fff;font-size:12px;font-family:inherit;"></textarea>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;user-select:none;">
          <input type="checkbox" id="pp-add-prefix-checkbox" checked style="cursor:pointer;">
          <span>Add phrase "create a image: "</span>
        </label>
      </div>
      <div style="display:flex;gap:6px;margin-top:4px;">
        <button id="pp-load-file-btn"
          style="padding:6px 8px;border-radius:6px;border:none;background:#059669;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">
          📁 Load file
        </button>
        <input type="file" id="pp-file-input" accept=".txt" style="display:none;">
        <button id="pp-start-btn"
          style="flex:1;padding:6px 8px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">
          ▶ Start queue
        </button>
        <button id="pp-stop-btn"
          style="padding:6px 8px;border-radius:6px;border:none;background:#444;color:#fff;cursor:pointer;font-size:12px;">
          ■ Stop
        </button>
      </div>
      <div style="display:flex;gap:6px;margin-top:4px;">
        <button id="pp-save-images-btn"
          style="flex:1;padding:6px 8px;border-radius:6px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">
          💾 Save all images
        </button>
      </div>
      <div id="pp-status"
        style="margin-top:4px;font-size:11px;opacity:0.8;">
        Idle.
      </div>
    `;

    document.body.appendChild(panel);

    const startBtn = panel.querySelector("#pp-start-btn");
    const stopBtn = panel.querySelector("#pp-stop-btn");
    const toggleBtn = panel.querySelector("#pp-toggle-panel");
    const loadFileBtn = panel.querySelector("#pp-load-file-btn");
    const fileInput = panel.querySelector("#pp-file-input");
    const saveImagesBtn = panel.querySelector("#pp-save-images-btn");

    startBtn.addEventListener("click", startQueue);
    stopBtn.addEventListener("click", stopQueue);
    saveImagesBtn.addEventListener("click", saveAllImages);
    toggleBtn.addEventListener("click", () => {
      const visible = panel.style.display !== "none";
      panel.style.display = visible ? "none" : "flex";
    });

    // Handle load file button click
    loadFileBtn.addEventListener("click", () => {
      fileInput.click();
    });

    // Handle file selection
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        const textarea = document.getElementById("pp-prompt-input");
        if (textarea) {
          textarea.value = content;
          setStatus(`Loaded ${file.name} (${content.split('\n').filter(l => l.trim()).length} prompts)`);
        }
      };
      reader.onerror = () => {
        setStatus("Error reading file. Please try again.");
      };
      reader.readAsText(file);
      
      // Reset file input so the same file can be loaded again
      fileInput.value = "";
    });
  }

  function setStatus(text) {
    const el = document.getElementById("pp-status");
    if (el) el.textContent = text;
  }

  // ---------- IMAGE SAVING ----------

  async function saveAllImages() {
    setStatus("Scanning for images...");
    
    // Find all images on the page
    const allImages = Array.from(document.querySelectorAll('img'));
    console.log(`Total images found: ${allImages.length}`);
    
    // Filter for actual content images (excluding small icons/UI elements)
    // Look for images with substantive src URLs (s3, cdn, etc.)
    const contentImages = allImages.filter(img => {
      const src = img.src;
      const className = img.className || '';
      
      // Exclude blurred background images (they have blur in their class)
      if (className.includes('blur-') || className.includes('blur')) {
        console.log(`Excluding blurred image: ${src.substring(0, 80)}...`);
        return false;
      }
      
      // Check if it matches our patterns
      const matchesPattern = src && 
             (src.includes('user-gen-media-assets') || 
              src.includes('ppl-ai-code-interpreter-files') ||
              src.includes('cdn') || 
              src.includes('amazonaws') ||
              src.includes('cloudinary') ||
              src.includes('imgix'));
      
      const sizeOk = img.naturalWidth > 50 && img.naturalHeight > 50;
      const notDataUri = !src.includes('data:image');
      
      if (matchesPattern && sizeOk && notDataUri) {
        console.log(`Including image: ${src.substring(0, 80)}... (${img.naturalWidth}x${img.naturalHeight})`);
        return true;
      }
      
      return false;
    });

    console.log(`Content images after filtering: ${contentImages.length}`);

    // Remove duplicates by URL
    const uniqueImages = [];
    const seenUrls = new Set();
    
    for (const img of contentImages) {
      const url = img.src;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        uniqueImages.push({ url, alt: img.alt || 'image', img });
        console.log(`Added unique image: ${url.substring(0, 80)}...`);
      } else {
        console.log(`Skipping duplicate: ${url.substring(0, 80)}...`);
      }
    }

    console.log(`Unique images to download: ${uniqueImages.length}`);

    if (uniqueImages.length === 0) {
      setStatus("No images found on this page.");
      return;
    }

    setStatus(`Found ${uniqueImages.length} images. Starting download...`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < uniqueImages.length; i++) {
      const { url, alt, img } = uniqueImages[i];
      setStatus(`Downloading image ${i + 1}/${uniqueImages.length}...`);
      console.log(`Starting download ${i + 1}: ${url}`);

      try {
        // Generate filename from URL or alt text
        const urlParts = url.split('/');
        const urlFilename = urlParts[urlParts.length - 1].split('?')[0]; // Remove query params
        const extension = urlFilename.includes('.') ? urlFilename.split('.').pop() : 'png';
        
        // Clean alt text for filename (remove special chars)
        const cleanAlt = alt.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const timestamp = Date.now();
        const filename = cleanAlt && cleanAlt !== 'image' 
          ? `${cleanAlt}_${timestamp}_${i + 1}.${extension}` 
          : `perplexity_image_${timestamp}_${i + 1}.${extension}`;
        
        console.log(`Generated filename: ${filename}`);

        // Use chrome.downloads API via background script (bypasses CORS completely)
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                action: 'downloadImage',
                url: url,
                filename: `perplexity_images/${filename}`
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              }
            );
          });

          if (response.success) {
            successCount++;
            console.log(`✓ Successfully downloaded image ${i + 1}`);
          } else {
            throw new Error(response.error || 'Download failed');
          }
          
        } catch (downloadError) {
          console.error(`✗ Failed to download image ${i + 1} via API:`, downloadError);
          
          // Fallback: Try canvas method (works for non-CORS images)
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            // Convert canvas to blob
            const blob = await new Promise((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas to blob failed'));
              }, 'image/png');
            });

            // Create download link with blob
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            }, 100);

            successCount++;
            console.log(`✓ Successfully downloaded image ${i + 1} via canvas fallback`);
            
          } catch (canvasError) {
            console.error(`✗ Both methods failed for image ${i + 1}:`, canvasError);
            failCount++;
          }
        }
        
        // Small delay between downloads to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 400));
        
      } catch (error) {
        console.error(`Failed to download image ${i + 1}:`, error);
        failCount++;
      }
    }

    const summary = `Done! Downloaded ${successCount} images${failCount > 0 ? `, ${failCount} failed` : ''}.`;
    setStatus(summary);
    console.log(summary);
  }

  // ---------- QUEUE LOGIC ----------

  function startQueue() {
    if (isRunning) {
      setStatus("Already running queue…");
      return;
    }

    const textarea = document.getElementById("pp-prompt-input");
    if (!textarea) return;

    const lines = textarea.value
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (!lines.length) {
      setStatus("No prompts to send. Add one per line.");
      return;
    }

    prompts = lines;
    currentIndex = 0;
    isRunning = true;
    setStatus(`Starting queue (${prompts.length} prompts)…`);
    runNextPrompt();
  }

  function stopQueue() {
    if (!isRunning) {
      setStatus("Queue is already stopped.");
      return;
    }
    isRunning = false;
    setStatus("Queue stopped by user.");
  }

  async function runNextPrompt() {
    if (!isRunning) {
      setStatus("Queue stopped.");
      return;
    }

    if (currentIndex >= prompts.length) {
      isRunning = false;
      setStatus("Done! All prompts submitted.");
      return;
    }

    let prompt = prompts[currentIndex];
    
    // Check if we should add the prefix
    const addPrefixCheckbox = document.getElementById("pp-add-prefix-checkbox");
    if (addPrefixCheckbox && addPrefixCheckbox.checked) {
      prompt = "create a image: " + prompt;
    }
    
    setStatus(`Sending prompt ${currentIndex + 1}/${prompts.length}…`);

    const ok = await sendPrompt(prompt);
    if (!ok) {
      isRunning = false;
      setStatus("Could not find Perplexity input. Make sure you're on the chat page.");
      return;
    }

    setStatus(
      `Waiting for response ${currentIndex + 1}/${prompts.length} to finish…`
    );
    await waitForResponseComplete({ maxMs: 120000 });

    setStatus(`Response ${currentIndex + 1}/${prompts.length} done.`);
    currentIndex += 1;
    runNextPrompt();
  }

  // ---------- PERPLEXITY-SPECIFIC HANDLING ----------

  async function sendPromptPerplexity(prompt) {
    const editor = document.getElementById("ask-input");
    if (!editor) return false;

    // Focus the Lexical editor
    editor.focus();

    // 1) CLEAR existing content
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch (e) {
      // Fallback: hard reset innerHTML if execCommand is blocked
      editor.innerHTML = "";
    }

    // 2) INSERT new prompt
    try {
      document.execCommand("insertText", false, prompt);
    } catch (e) {
      // Fallback: set textContent
      editor.textContent = prompt;
    }

    // 3) Notify Lexical that content changed
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: true })
    );

    // 4) Wait 2 seconds before submitting
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 5) Click the real submit button if available
    const submitBtn = document.querySelector('button[data-testid="submit-button"]');
    if (submitBtn) {
      submitBtn.click();
    } else {
      // Fallback: simulate pressing Enter on the editor
      const evtOptions = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      };
      editor.dispatchEvent(new KeyboardEvent("keydown", evtOptions));
      editor.dispatchEvent(new KeyboardEvent("keyup", evtOptions));
    }

    return true;
  }

  // ---------- GENERIC FALLBACK (other sites, if ever reused) ----------

  function findPromptInputGeneric() {
    const candidates = Array.from(
      document.querySelectorAll("textarea, [contenteditable='true']")
    );

    const visible = candidates.filter(
      (el) => el.offsetParent !== null && !el.disabled
    );

    const withPlaceholder = visible.find((el) => {
      const ph = el.placeholder || "";
      return /ask.*anything|search|question/i.test(ph);
    });

    if (withPlaceholder) return withPlaceholder;

    const withRole = visible.find(
      (el) => el.getAttribute("role") === "textbox"
    );
    if (withRole) return withRole;

    return visible[0] || null;
  }

  async function sendPromptGeneric(prompt) {
    const input = findPromptInputGeneric();
    if (!input) return false;

    if (input.tagName === "TEXTAREA") {
      const prototype =
        window.HTMLTextAreaElement && HTMLTextAreaElement.prototype;
      const descriptor =
        prototype && Object.getOwnPropertyDescriptor(prototype, "value");
      const setter = descriptor && descriptor.set;

      if (setter) {
        setter.call(input, prompt);
      } else {
        input.value = prompt;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (input.getAttribute("contenteditable") === "true") {
      input.focus();
      input.textContent = prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      input.value = prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    input.focus();

    const evtOptions = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    input.dispatchEvent(new KeyboardEvent("keydown", evtOptions));
    input.dispatchEvent(new KeyboardEvent("keyup", evtOptions));

    return true;
  }

  async function sendPrompt(prompt) {
    const host = location.hostname || "";
    if (host.includes("perplexity.ai")) {
      return await sendPromptPerplexity(prompt);
    }
    return await sendPromptGeneric(prompt);
  }

  // ---------- "Working…" WATCHER + EXTRA DELAY ----------

  function findWorkingElement() {
    // Look for the "Working…" indicator
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      if (div.textContent.trim() === "Working…") {
        return div;
      }
    }
    return null;
  }

  function waitForResponseComplete({ maxMs = 120000 } = {}) {
    const extraWaitMs = 3000;       // extra wait AFTER Working… disappears
    const disappearStableMs = 1000; // how long it must stay gone
    const checkIntervalMs = 400;    // how often we poll
    const noSpinnerMaxMs = 6000;    // if we never see "Working…" after this, just proceed

    return new Promise((resolve) => {
      const start = Date.now();
      let lastSeen = null;
      let seenEver = false;

      const done = () => {
        clearInterval(interval);
        clearTimeout(overallTimeout);
        // wait the extra 3 seconds requested
        setTimeout(resolve, extraWaitMs);
      };

      const interval = setInterval(() => {
        const now = Date.now();
        if (now - start > maxMs) {
          // Safety fallback if something goes wrong
          done();
          return;
        }

        const el = findWorkingElement();
        if (el) {
          seenEver = true;
          lastSeen = now;
          return;
        }

        // If we've seen "Working…" before and it's now gone long enough,
        // we consider the response finished.
        if (seenEver && lastSeen !== null && now - lastSeen >= disappearStableMs) {
          done();
          return;
        }

        // If we never see the spinner at all, don't wait forever
        if (!seenEver && now - start >= noSpinnerMaxMs) {
          done();
        }
      }, checkIntervalMs);

      const overallTimeout = setTimeout(() => {
        // Max timeout fallback
        done();
      }, maxMs);
    });
  }

  // ---------- INIT ----------

  function init() {
    if (
      document.readyState === "complete" ||
      document.readyState === "interactive"
    ) {
      createPanel();
    } else {
      window.addEventListener("DOMContentLoaded", createPanel, { once: true });
    }

    // Alt+P toggles the panel
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.key.toLowerCase() === "p") {
        const panel = document.getElementById("pp-multi-prompt-panel");
        if (!panel) {
          createPanel();
        } else {
          panel.style.display =
            panel.style.display === "none" ? "flex" : "none";
        }
      }
    });
  }

  init();
})();
