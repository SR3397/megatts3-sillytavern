import { debounce_timeout } from '../../constants.js';
import { debounceAsync, splitRecursive } from '../../utils.js';
import { getPreviewString, saveTtsProviderSettings } from './index.js';

export class MegaTts3Provider {
    constructor() {
        this.settings = {
            server_url: 'http://localhost:7929',
            voice_directory: '/home/user1/MegaTTS3/assets/voices',  // Fix: remove leading dot
            default_voice: 'default',
            p_w: 2.0,  // intelligibility weight
            t_w: 3.0,  // timbre weight
            speakingRate: 1.0,
            voiceMap: {},
            use_gradio_api: true,
            auto_discover_voices: true,  // Auto-discover voices from directory
        };
        this.ready = false;
        this.voices = [];
        this.separator = ' ... ... ... ';
        this.pendingRequests = new Map();
        this.nextRequestId = 1;

        // Update display values immediately but only reinitialize TTS after a delay
        this.checkServerDebounced = debounceAsync(this.checkServerStatus.bind(this), debounce_timeout.relaxed);
    }

    /**
     * Perform any text processing before passing to TTS engine.
     * @param {string} text Input text
     * @returns {string} Processed text
     */
    processText(text) {
        // Basic text preprocessing for MegaTTS3
        text = text.replace(/~/g, '.');
        // Remove excessive whitespace
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    }

    async loadSettings(settings) {
        if (settings.server_url !== undefined) this.settings.server_url = settings.server_url;
        if (settings.voice_directory !== undefined) this.settings.voice_directory = settings.voice_directory;
        if (settings.default_voice !== undefined) this.settings.default_voice = settings.default_voice;
        if (settings.p_w !== undefined) this.settings.p_w = settings.p_w;
        if (settings.t_w !== undefined) this.settings.t_w = settings.t_w;
        if (settings.speakingRate !== undefined) this.settings.speakingRate = settings.speakingRate;
        if (settings.voiceMap !== undefined) this.settings.voiceMap = settings.voiceMap;
        if (settings.use_gradio_api !== undefined) this.settings.use_gradio_api = settings.use_gradio_api;
        if (settings.auto_discover_voices !== undefined) this.settings.auto_discover_voices = settings.auto_discover_voices;

        // Bind UI elements
        $('#megatts3_server_url').val(this.settings.server_url).on('input', this.onSettingsChange.bind(this));
        $('#megatts3_voice_directory').val(this.settings.voice_directory).on('input', this.onSettingsChange.bind(this));
        $('#megatts3_default_voice').val(this.settings.default_voice).on('input', this.onSettingsChange.bind(this));
        $('#megatts3_p_w').val(this.settings.p_w).on('input', this.onSettingsChange.bind(this));
        $('#megatts3_t_w').val(this.settings.t_w).on('input', this.onSettingsChange.bind(this));
        $('#megatts3_speaking_rate').val(this.settings.speakingRate).on('input', this.onSettingsChange.bind(this));
        $('#megatts3_use_gradio_api').prop('checked', this.settings.use_gradio_api).on('change', this.onSettingsChange.bind(this));
        $('#megatts3_auto_discover_voices').prop('checked', this.settings.auto_discover_voices).on('change', this.onSettingsChange.bind(this));
        
        // Bind refresh button
        $('#megatts3_refresh_voices').on('click', this.onRefreshVoicesClick.bind(this));
        
        // Update output displays
        $('#megatts3_p_w_output').text(this.settings.p_w);
        $('#megatts3_t_w_output').text(this.settings.t_w);
        $('#megatts3_speaking_rate_output').text(this.settings.speakingRate + 'x');

        // Initial server check and voice discovery
        await this.checkServerStatus();
    }

    async checkServerStatus() {
        try {
            // First try to access the main Gradio interface
            const response = await fetch(`${this.settings.server_url}/`);
            
            if (response.ok) {
                this.ready = true;
                this.updateStatusDisplay('Ready', 'green');
                
                // Try to discover available API endpoints
                await this.discoverApiEndpoints();
                
                // Try to load available voices
                await this.loadAvailableVoices();
            } else {
                this.ready = false;
                this.updateStatusDisplay('Server Error', 'red');
            }
        } catch (error) {
            console.error('MegaTTS3 server check failed:', error);
            this.ready = false;
            this.updateStatusDisplay('Not Connected', 'red');
        }
    }

    async discoverApiEndpoints() {
        console.log('Discovering MegaTTS3 API endpoints...');
        
        // Try to get the Gradio config which tells us about available endpoints
        const configEndpoints = [
            '/config',
            '/api/config', 
            '/info',
            '/api/info',
            '/app_info',
            '/api'
        ];
        
        for (const endpoint of configEndpoints) {
            try {
                const response = await fetch(`${this.settings.server_url}${endpoint}`);
                if (response.ok) {
                    const data = await response.json();
                    console.log('Found config at', endpoint, ':', data);
                    
                    // Look for function information that might tell us the correct endpoint
                    if (data.dependencies) {
                        console.log('Available functions:', data.dependencies);
                        data.dependencies.forEach((dep, index) => {
                            console.log('Function', index, ':', dep);
                        });
                    }
                    
                    if (data.paths) {
                        console.log('Available paths:', data.paths);
                    }
                    
                    if (data.endpoints) {
                        console.log('Available endpoints:', data.endpoints);
                    }
                    
                    break;
                }
            } catch (error) {
                // Continue to next endpoint
            }
        }
        
        // Also try to discover by checking common patterns - prioritize /predict
        console.log('Testing common endpoint patterns...');
        const testEndpoints = [
            '/predict',         // This should be the correct one according to API recorder
            '/run/predict',     // Alternative
            '/api/predict',     // Alternative 
            '/api/run/predict',
            '/call/predict',
            '/queue/join',
            '/api/queue/join'
        ];
        
        for (const endpoint of testEndpoints) {
            try {
                // Send a minimal test request to see what happens
                const testResponse = await fetch(`${this.settings.server_url}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: [] })
                });
                
                const statusInfo = {
                    endpoint: endpoint,
                    status: testResponse.status,
                    statusText: testResponse.statusText
                };
                
                if (testResponse.status !== 404) {
                    console.log('Potential working endpoint found:', statusInfo);
                    try {
                        const responseText = await testResponse.text();
                        console.log('Response preview:', responseText.substring(0, 200));
                    } catch (e) {
                        // Ignore response reading errors
                    }
                } else {
                    console.log('404 endpoint:', endpoint);
                }
            } catch (error) {
                console.log(endpoint, 'error:', error.message);
            }
        }
    }

    async loadAvailableVoices() {
        if (this.settings.auto_discover_voices) {
            console.log('🔍 Auto-discovering voices from directory...');
            this.updateVoiceStatus('Discovering voices...', 'blue');
            
            try {
                const discoveredVoices = await this.discoverVoicesFromDirectory();
                if (discoveredVoices.length > 0) {
                    this.voices = discoveredVoices;
                    console.log('✅ Auto-discovered voices:', this.voices);
                    
                    // Show concise status for many voices
                    if (this.voices.length <= 5) {
                        this.updateVoiceStatus(`Found ${this.voices.length} voices: ${this.voices.join(', ')}`, 'green');
                    } else {
                        const preview = this.voices.slice(0, 3).join(', ');
                        this.updateVoiceStatus(`Found ${this.voices.length} voices: ${preview} and ${this.voices.length - 3} more`, 'green');
                    }
                } else {
                    console.warn('⚠️ No voices discovered, using fallback');
                    this.voices = [this.settings.default_voice || 'default'];
                    this.updateVoiceStatus('No voices found. Check voice directory and CORS server.', 'orange');
                }
            } catch (error) {
                console.error('❌ Voice discovery failed:', error);
                this.voices = [this.settings.default_voice || 'default'];
                this.updateVoiceStatus(`Discovery failed: ${error.message}`, 'red');
            }
        } else {
            // Manual mode - use default voice only
            this.voices = [this.settings.default_voice || 'default'];
            this.updateVoiceStatus('Auto-discovery disabled. Using default voice only.', 'gray');
            console.log('📝 Manual mode - using default voice:', this.voices);
        }
    }

    async discoverVoicesFromDirectory() {
        let discoveredVoices = [];
        
        // Get the CORS server URL (port 8000)
        const corsServerUrl = this.settings.server_url.replace(':7929', ':8000');
        
        // Extract relative path from voice directory
        const relativePath = this.settings.voice_directory.includes('/assets/') ? 
            this.settings.voice_directory.substring(this.settings.voice_directory.indexOf('/assets/')) : 
            `/assets/voices`;
        
        console.log('🔍 Checking CORS server for voices:', corsServerUrl + relativePath);
        
        try {
            // Method 1: Try to get directory listing from CORS server
            const listingUrl = `${corsServerUrl}${relativePath}/?list=1`;
            console.log('📂 Attempting directory listing:', listingUrl);
            
            let useDirectoryListing = false;
            try {
                const listingResponse = await fetch(listingUrl);
                if (listingResponse.ok) {
                    const listingText = await listingResponse.text();
                    console.log('📋 Directory listing received:', listingText.substring(0, 500));
                    
                    // Parse directory listing for voice files - handle HTML links and spaces
                    let wavFiles = [];
                    let npyFiles = [];
                    
                    // Method 1: Parse HTML href links (handles spaces and URL encoding)
                    const hrefMatches = listingText.matchAll(/href=["']([^"']*\.(wav|npy))["']/gi);
                    for (const match of hrefMatches) {
                        const filename = decodeURIComponent(match[1]); // Decode %20 -> space
                        const basename = filename.replace(/\.(wav|npy)$/, '');
                        
                        if (filename.endsWith('.wav')) {
                            wavFiles.push(basename);
                        } else if (filename.endsWith('.npy')) {
                            npyFiles.push(basename);
                        }
                    }
                    
                    // Method 2: Fallback - parse plain text (if no HTML)
                    if (wavFiles.length === 0 && npyFiles.length === 0) {
                        console.log('📋 No HTML links found, trying plain text parsing...');
                        const wavMatches = listingText.matchAll(/([^\s<>\/]+\.wav)/gi);
                        const npyMatches = listingText.matchAll(/([^\s<>\/]+\.npy)/gi);
                        
                        for (const match of wavMatches) {
                            const basename = match[1].replace('.wav', '');
                            wavFiles.push(basename);
                        }
                        
                        for (const match of npyMatches) {
                            const basename = match[1].replace('.npy', '');
                            npyFiles.push(basename);
                        }
                    }
                    
                    console.log('📁 Found WAV files:', wavFiles);
                    console.log('📁 Found NPY files:', npyFiles);
                    
                    // Only include voices that have both .wav and .npy files
                    const validVoices = wavFiles.filter(name => npyFiles.includes(name));
                    console.log('🎯 Valid voice pairs found via listing:', validVoices);
                    
                    if (validVoices.length > 0) {
                        discoveredVoices = validVoices;
                        useDirectoryListing = true;
                    }
                }
            } catch (listingError) {
                console.log('📂 Directory listing not available, trying probe method');
            }
            
            // Method 2: Only probe if directory listing failed or found no voices
            if (!useDirectoryListing) {
                console.log('🔍 Probing for common voice files...');
                const commonVoiceNames = [
                    'default', 'female', 'male', 'english', 'chinese', 
                    'diablo', 'character', 'voice1', 'voice2', 'voice3',
                    'speaker1', 'speaker2', 'narrator', 'main', 'p1-denoise'
                ];
                
                for (const voiceName of commonVoiceNames) {
                    try {
                        const hasValidPair = await this.checkVoiceFilePair(voiceName, corsServerUrl, relativePath);
                        if (hasValidPair) {
                            discoveredVoices.push(voiceName);
                            console.log('✅ Found valid voice pair:', voiceName);
                        }
                    } catch (error) {
                        // Continue checking other voices
                    }
                }
            }
            
            // Remove duplicates and sort
            const uniqueVoices = [...new Set(discoveredVoices)].sort();
            console.log('🎯 Final unique voices:', uniqueVoices);
            
            return uniqueVoices;
            
        } catch (error) {
            console.error('❌ Voice discovery failed:', error);
            throw new Error('Failed to discover voices from directory');
        }
    }

    async checkVoiceFilePair(voiceName, corsServerUrl, relativePath) {
        // Check if both .wav and .npy files exist for this voice
        const wavUrl = `${corsServerUrl}${relativePath}/${voiceName}.wav`;
        const npyUrl = `${corsServerUrl}${relativePath}/${voiceName}.npy`;
        
        console.log(`🔍 Checking voice pair: ${voiceName}`);
        
        try {
            // Check both files with HEAD requests (faster than GET)
            const [wavResponse, npyResponse] = await Promise.all([
                fetch(wavUrl, { method: 'HEAD' }),
                fetch(npyUrl, { method: 'HEAD' })
            ]);
            
            const hasWav = wavResponse.ok;
            const hasNpy = npyResponse.ok;
            
            console.log(`📁 ${voiceName}: WAV=${hasWav}, NPY=${hasNpy}`);
            
            return hasWav && hasNpy;
        } catch (error) {
            console.log(`❌ Error checking ${voiceName}:`, error.message);
            return false;
        }
    }

    updateVoiceStatus(message, color) {
        const statusElement = $('#megatts3_voice_status');
        if (statusElement.length) {
            statusElement.text(message).css('color', color);
        }
    }

    async onRefreshVoicesClick() {
        console.log('🔄 Manual voice refresh requested');
        this.updateVoiceStatus('Refreshing voices...', 'blue');
        await this.loadAvailableVoices();
        
        // Trigger a UI update if needed
        if (typeof saveTtsProviderSettings === 'function') {
            saveTtsProviderSettings();
        }
        
        return true;
    }

    updateStatusDisplay(text, color) {
        $('#megatts3_status_text').text(text).css('color', color);
    }

    async checkReady() {
        if (!this.ready) {
            await this.checkServerStatus();
        }
        return this.ready;
    }

    async onRefreshClick() {
        return await this.checkServerStatus();
    }

    get settingsHtml() {
        return `
            <div class="megatts3_tts_settings">
                <label for="megatts3_server_url">Server URL:</label>
                <input id="megatts3_server_url" type="text" class="text_pole" value="${this.settings.server_url}" />
                <small>URL where MegaTTS3 gradio interface is running (default: http://localhost:7929)</small>

                <label for="megatts3_voice_directory">Voice Directory:</label>
                <input id="megatts3_voice_directory" type="text" class="text_pole" value="${this.settings.voice_directory}" />
                <small>**Absolute path** to directory containing reference audio files and .npy latents (relative to MegaTTS3 server, not SillyTavern)</small>

                <label for="megatts3_default_voice">Default Voice:</label>
                <input id="megatts3_default_voice" type="text" class="text_pole" value="${this.settings.default_voice}" />
                <small>Default voice name (without file extension)</small>

                <div style="margin: 15px 0;">
                    <label>
                        <input id="megatts3_auto_discover_voices" type="checkbox" ${this.settings.auto_discover_voices ? 'checked' : ''} />
                        Auto-discover voices from directory
                    </label>
                    <button id="megatts3_refresh_voices" type="button" style="margin-left: 10px; padding: 5px 10px;">🔄 Refresh Voices</button>
                    <br>
                    <small>Automatically finds voices (.wav + .npy pairs) in the voice directory. Requires CORS server on port 8000.</small>
                    <div id="megatts3_voice_status" style="margin-top: 5px; font-size: 0.9em;"></div>
                </div>

                <label for="megatts3_p_w">Intelligibility Weight: <span id="megatts3_p_w_output">${this.settings.p_w}</span></label>
                <input id="megatts3_p_w" type="range" value="${this.settings.p_w}" min="1.0" max="5.0" step="0.1" />
                <small>Higher values = clearer pronunciation, lower = more accent preservation</small>

                <label for="megatts3_t_w">Timbre Weight: <span id="megatts3_t_w_output">${this.settings.t_w}</span></label>
                <input id="megatts3_t_w" type="range" value="${this.settings.t_w}" min="1.0" max="5.0" step="0.1" />
                <small>Higher values = more expressive and similar to reference voice</small>

                <label for="megatts3_speaking_rate">Speaking Rate: <span id="megatts3_speaking_rate_output">${this.settings.speakingRate}x</span></label>
                <input id="megatts3_speaking_rate" type="range" value="${this.settings.speakingRate}" min="0.5" max="2.0" step="0.1" />

                <label>
                    <input id="megatts3_use_gradio_api" type="checkbox" ${this.settings.use_gradio_api ? 'checked' : ''} />
                    Use Gradio API (recommended)
                </label>
                <small>If unchecked, will attempt to use CLI interface</small>

                <hr>
                <div>
                    Status: <span id="megatts3_status_text">Initializing...</span>
                </div>
                <div style="margin-top: 10px;">
                    <small>
                        <strong>Setup Instructions:</strong><br>
                        1. Install MegaTTS3: <code>git clone https://github.com/bytedance/MegaTTS3.git</code><br>
                        2. Install dependencies: <code>pip install -r requirements.txt</code><br>
                        3. Download checkpoints to <code>./checkpoints/</code><br>
                        4. Run gradio server: <code>python tts/gradio_api.py</code><br>
                        5. Run CORS server: <code>python cors_server.py</code> (for voice auto-discovery)<br>
                        6. Place voice files (.wav) and latents (.npy) in voice directory<br><br>
                        <strong>Note:</strong> "attention_mask" warnings in MegaTTS3 console are normal and don't affect audio quality.
                    </small>
                </div>
            </div>
        `;
    }

    async onSettingsChange() {
        this.settings.server_url = $('#megatts3_server_url').val().toString();
        this.settings.voice_directory = $('#megatts3_voice_directory').val().toString();
        this.settings.default_voice = $('#megatts3_default_voice').val().toString();
        this.settings.p_w = parseFloat($('#megatts3_p_w').val().toString());
        this.settings.t_w = parseFloat($('#megatts3_t_w').val().toString());
        this.settings.speakingRate = parseFloat($('#megatts3_speaking_rate').val().toString());
        this.settings.use_gradio_api = $('#megatts3_use_gradio_api').prop('checked');
        this.settings.auto_discover_voices = $('#megatts3_auto_discover_voices').prop('checked');

        // Update UI displays
        $('#megatts3_p_w_output').text(this.settings.p_w);
        $('#megatts3_t_w_output').text(this.settings.t_w);
        $('#megatts3_speaking_rate_output').text(this.settings.speakingRate + 'x');

        // Reload voices when auto-discovery setting changes or voice directory changes
        await this.loadAvailableVoices();

        // Check server with debounce
        this.checkServerDebounced();
        saveTtsProviderSettings();
    }

    async fetchTtsVoiceObjects() {
        if (!this.ready) {
            await this.checkReady();
        }
        
        return this.voices.map(voice => ({
            name: voice,           // Full voice name (e.g., "p1-denoise")
            voice_id: voice,       // Full voice ID (e.g., "p1-denoise") 
            preview_url: null,
            lang: voice.includes('chinese') ? 'zh-CN' : 'en-US',
            // Ensure SillyTavern displays the full name including dashes
            display_name: voice,   // Explicit display name
        }));
    }

    async previewTtsVoice(voiceId) {
        if (!this.ready) {
            await this.checkReady();
        }

        const voice = this.getVoice(voiceId);
        // Shorter preview text to reduce GPU usage and inference time
        const previewText = voice.lang === 'zh-CN' ? '你好，这是语音预览。' : 'Hello, this is a voice preview.';
        
        console.log('🎵 Playing voice preview for:', voiceId, 'Text:', previewText);
        
        try {
            for await (const response of this.generateTts(previewText, voiceId)) {
                const audio = await response.blob();
                const url = URL.createObjectURL(audio);
                await new Promise(resolve => {
                    const audioElement = new Audio();
                    audioElement.src = url;
                    audioElement.play();
                    audioElement.onended = () => resolve();
                });
                URL.revokeObjectURL(url);
                break; // Only play first chunk for preview
            }
        } catch (error) {
            console.error('Preview failed:', error);
        }
    }

    getVoiceDisplayName(voiceId) {
        // Return the full voice ID including dashes and special characters
        return voiceId;
    }

    getVoice(voiceName) {
        const defaultVoice = this.settings.default_voice || 'default';
        const actualVoiceName = this.voices.includes(voiceName) ? voiceName : defaultVoice;
        return {
            name: actualVoiceName,           // Full name with dashes (e.g., "p1-denoise")
            voice_id: actualVoiceName,       // Full voice ID with dashes
            preview_url: null,
            lang: actualVoiceName.includes('chinese') ? 'zh-CN' : 'en-US',
            display_name: actualVoiceName,   // Explicit display name
        };
    }

    /**
     * Generate TTS audio using MegaTTS3
     * @param {string} text Text to generate
     * @param {string} voiceId Voice ID
     * @returns {AsyncGenerator<Response>} Audio response generator
     */
    async* generateTts(text, voiceId) {
        if (!this.ready) {
            await this.checkReady();
        }

        if (!this.ready) {
            throw new Error('MegaTTS3 server not ready');
        }

        if (text.trim().length === 0) {
            throw new Error('Empty text');
        }

        const voice = this.getVoice(voiceId);
        const processedText = this.processText(text);

        // For MegaTTS3, avoid chunking unless text is extremely long (>1000 chars)
        // This prevents multiple GPU inference calls for normal-length text
        const maxLength = 1000;
        
        if (processedText.length <= maxLength) {
            // Single request for normal text - most efficient
            console.log('🎯 Single inference for text length:', processedText.length, 'characters');
            if (this.settings.use_gradio_api) {
                yield await this.generateWithGradioApi(processedText, voice.voice_id);
            } else {
                yield await this.generateWithCli(processedText, voice.voice_id);
            }
        } else {
            // Only chunk for very long texts
            console.log('📝 Chunking long text:', processedText.length, 'characters');
            const chunkSize = 500; // Larger chunks for fewer requests
            const chunks = splitRecursive(processedText, chunkSize, ['\n\n', '\n', '.', '?', '!', ',', ' ', '']);
            console.log('📦 Created', chunks.length, 'chunks');
            
            for (let i = 0; i < chunks.length; i++) {
                console.log(`🎵 Processing chunk ${i + 1}/${chunks.length}`);
                if (this.settings.use_gradio_api) {
                    yield await this.generateWithGradioApi(chunks[i], voice.voice_id);
                } else {
                    yield await this.generateWithCli(chunks[i], voice.voice_id);
                }
            }
        }
    }

    async generateWithGradioApi(text, voiceId) {
        try {
            const requestId = this.nextRequestId++;
            console.log(`🚀 [Request ${requestId}] Starting MegaTTS3 generation for voice: ${voiceId}`);
            console.log(`📝 [Request ${requestId}] Text length: ${text.length} characters`);
            
            // Construct the file paths
            const audioPath = `${this.settings.voice_directory}/${voiceId}.wav`;
            const npyPath = `${this.settings.voice_directory}/${voiceId}.npy`;
            
            console.log('🎵 Generating TTS with MegaTTS3:', {
                text: text,
                voiceId: voiceId,
                audioPath: audioPath,
                npyPath: npyPath,
                infer_timestep: 32,
                p_w: this.settings.p_w,
                t_w: this.settings.t_w,
                server: this.settings.server_url
            });
            
            // First, we need to upload the files to MegaTTS3
            console.log('📁 Starting file upload process...');
            
            let uploadedAudio, uploadedNpy;
            
            try {
                console.log('📁 Uploading audio file...');
                uploadedAudio = await this.uploadFileToGradio(audioPath);
                console.log('✅ Audio upload result:', uploadedAudio);
                
                // Add a small delay between uploads to prevent CORS race conditions
                console.log('⏳ Waiting 500ms before NPY upload...');
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (audioError) {
                console.error('❌ Audio upload failed:', audioError);
                throw new Error(`Audio file upload failed: ${audioError.message}`);
            }
            
            try {
                console.log('📁 Uploading NPY file...');
                uploadedNpy = await this.uploadFileToGradio(npyPath);
                console.log('✅ NPY upload result:', uploadedNpy);
            } catch (npyError) {
                console.error('❌ NPY upload failed:', npyError);
                
                // If NPY fails due to CORS, try again after a longer delay
                if (npyError.message.includes('CORS')) {
                    console.log('🔄 CORS issue detected, retrying NPY upload after 2 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    try {
                        uploadedNpy = await this.uploadFileToGradio(npyPath);
                        console.log('✅ NPY upload retry successful:', uploadedNpy);
                    } catch (retryError) {
                        console.error('❌ NPY upload retry also failed:', retryError);
                        throw new Error(`NPY file upload failed after retry: ${retryError.message}`);
                    }
                } else {
                    throw new Error(`NPY file upload failed: ${npyError.message}`);
                }
            }
            
            console.log('✅ Files uploaded:', { uploadedAudio, uploadedNpy });
            
            // Verify FileData structure before sending - THIS IS CRITICAL
            console.log('🔍 DETAILED FileData structure analysis:');
            
            console.log('=== AUDIO FILE ===');
            console.log('Type:', typeof uploadedAudio);
            console.log('Keys:', Object.keys(uploadedAudio));
            console.log('Full object:', JSON.stringify(uploadedAudio, null, 2));
            console.log('Meta field type:', typeof uploadedAudio.meta);
            console.log('Meta field value:', JSON.stringify(uploadedAudio.meta, null, 2));
            
            console.log('=== NPY FILE ===');
            console.log('Type:', typeof uploadedNpy);
            console.log('Keys:', Object.keys(uploadedNpy));
            console.log('Full object:', JSON.stringify(uploadedNpy, null, 2));
            console.log('Meta field type:', typeof uploadedNpy.meta);
            console.log('Meta field value:', JSON.stringify(uploadedNpy.meta, null, 2));
            
            // Double-check that we're not accidentally passing strings
            if (typeof uploadedAudio === 'string') {
                console.error('❌ ERROR: uploadedAudio is a string, should be FileData object!');
                throw new Error('File upload failed: received string instead of FileData object for audio file');
            }
            if (typeof uploadedNpy === 'string') {
                console.error('❌ ERROR: uploadedNpy is a string, should be FileData object!');
                throw new Error('File upload failed: received string instead of FileData object for NPY file');
            }
            
            // Create EXACT FileData structure as discovered in browser inspection
            const properAudioData = {
                "path": uploadedAudio.path || uploadedAudio.name,
                "url": uploadedAudio.url || `${this.settings.server_url}/gradio_api/file=${uploadedAudio.path || uploadedAudio.name}`,
                "orig_name": uploadedAudio.orig_name || uploadedAudio.name,
                "size": uploadedAudio.size,
                "mime_type": uploadedAudio.mime_type || "audio/x-wav",
                "meta": {"_type": "gradio.FileData"}
            };
            
            const properNpyData = {
                "path": uploadedNpy.path || uploadedNpy.name,
                "url": uploadedNpy.url || `${this.settings.server_url}/gradio_api/file=${uploadedNpy.path || uploadedNpy.name}`,
                "orig_name": uploadedNpy.orig_name || uploadedNpy.name, 
                "size": uploadedNpy.size,
                "mime_type": uploadedNpy.mime_type || "",
                "meta": {"_type": "gradio.FileData"}
            };
            
            console.log('=== RECONSTRUCTED FILEDATA ===');
            console.log('Proper Audio:', JSON.stringify(properAudioData, null, 2));
            console.log('Proper NPY:', JSON.stringify(properNpyData, null, 2));
            
            // Final validation of meta field structure
            console.log('=== META FIELD VALIDATION ===');
            console.log('Audio meta type:', typeof properAudioData.meta);
            console.log('Audio meta._type:', properAudioData.meta._type);
            console.log('Audio meta equals expected:', JSON.stringify(properAudioData.meta) === JSON.stringify({"_type": "gradio.FileData"}));
            
            console.log('NPY meta type:', typeof properNpyData.meta);
            console.log('NPY meta._type:', properNpyData.meta._type);
            console.log('NPY meta equals expected:', JSON.stringify(properNpyData.meta) === JSON.stringify({"_type": "gradio.FileData"}));
            
            // Ensure meta field is exactly right
            properAudioData.meta = {"_type": "gradio.FileData"};
            properNpyData.meta = {"_type": "gradio.FileData"};
            
            // Generate session hash for EventSource connection
            const sessionHash = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            // DISCOVERED: MegaTTS3 uses /gradio_api/queue/join with queue system
            // Based on manual discovery via browser dev tools
            const payload = {
                data: [
                    properAudioData,    // Use reconstructed FileData object for .wav
                    properNpyData,      // Use reconstructed FileData object for .npy
                    text,               // Text to generate
                    32,                 // infer_timestep 
                    this.settings.p_w,  // p_w (intelligibility weight)
                    this.settings.t_w   // t_w (similarity weight)
                ],
                event_data: null,
                fn_index: 0,        // From discovery: function index 0
                trigger_id: 16,     // From discovery: trigger ID 16  
                session_hash: sessionHash
            };

            console.log('🎯 FINAL payload being sent to /gradio_api/queue/join:');
            console.log('Payload data[0] (audio):', JSON.stringify(payload.data[0], null, 2));
            console.log('Payload data[1] (npy):', JSON.stringify(payload.data[1], null, 2));
            console.log('Complete payload:', JSON.stringify(payload, null, 2));

            const response = await fetch(`${this.settings.server_url}/gradio_api/queue/join`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            console.log('📡 Queue response:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });

            if (response.ok) {
                const result = await response.json();
                console.log('🎉 API call successful:', result);
                
                // CRITICAL: MegaTTS3 returns audio bytes directly in result.data[0] according to source code analysis
                if (result && result.data && result.data.length > 0) {
                    console.log('✅ Got direct audio data from API call!');
                    const audioData = result.data[0];
                    console.log('📦 Audio data type:', typeof audioData);
                    console.log('📦 Audio data length/size:', audioData?.length || audioData?.byteLength || audioData?.size || 'unknown');
                    
                    return await this.handleDirectAudioBytes(audioData);
                }
                
                // If we got a queue response, listen via EventSource
                if (result && result.event_id) {
                    console.log('📋 Got queue response with event_id:', result.event_id);
                    console.log('🔄 Listening for audio data via EventSource...');
                    
                    // Use EventSource to listen for completion
                    return await this.listenForAudioBytes(result.event_id, sessionHash);
                }
                
                console.error('❌ Unexpected API response structure:', result);
                throw new Error('Invalid response from MegaTTS3: No audio data or event_id received');
            } else {
                const errorText = await response.text();
                console.error('❌ Queue join failed:', response.status, errorText);
                throw new Error(`Queue join failed: ${response.status} ${response.statusText}. Response: ${errorText}`);
            }

        } catch (error) {
            console.error('❌ MegaTTS3 generation failed:', error);
            throw new Error(`MegaTTS3 generation failed: ${error.message}`);
        }
    }
    async handleDirectAudioBytes(audioData) {
        console.log('🎵 Processing direct audio data from MegaTTS3...');
        console.log('📦 Audio data type:', typeof audioData);
        console.log('📦 Audio data constructor:', audioData?.constructor?.name);
        console.log('📦 Audio data object:', JSON.stringify(audioData, null, 2));
        
        // Handle different audio data formats that MegaTTS3 might return
        if (audioData instanceof ArrayBuffer) {
            console.log('✅ Got ArrayBuffer audio data:', audioData.byteLength, 'bytes');
            return new Response(audioData, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (audioData instanceof Uint8Array) {
            console.log('✅ Got Uint8Array audio data:', audioData.length, 'bytes');
            return new Response(audioData.buffer, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (Array.isArray(audioData)) {
            console.log('✅ Got array audio data, converting to Uint8Array:', audioData.length, 'elements');
            const uint8Array = new Uint8Array(audioData);
            return new Response(uint8Array.buffer, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (audioData instanceof Blob) {
            console.log('✅ Got Blob audio data:', audioData.size, 'bytes');
            return new Response(audioData, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (typeof audioData === 'string' && audioData.startsWith('data:audio')) {
            console.log('✅ Got data URL, converting to blob...');
            const response = await fetch(audioData);
            const blob = await response.blob();
            return new Response(blob, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (audioData && typeof audioData === 'object' && audioData.url) {
            // NEW: Handle file object with URL (what we're getting now)
            console.log('✅ Got file object with URL, downloading audio...');
            console.log('🔗 Audio file URL:', audioData.url);
            console.log('📁 Audio file path:', audioData.path);
            
            try {
                const audioResponse = await fetch(audioData.url, {
                    headers: {
                        'Referer': `${this.settings.server_url}/?`
                    }
                });
                
                console.log('📡 Audio download response:', audioResponse.status, audioResponse.statusText);
                
                if (audioResponse.ok) {
                    const audioBlob = await audioResponse.blob();
                    console.log('✅ Successfully downloaded audio:', audioBlob.size, 'bytes');
                    
                    // Small delay to prevent rapid-fire requests
                    if (audioBlob.size > 1000) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                    return new Response(audioBlob, {
                        headers: { 'Content-Type': 'audio/wav' }
                    });
                } else {
                    console.error('❌ Failed to download audio file:', audioResponse.status, audioResponse.statusText);
                    throw new Error(`Failed to download audio file: ${audioResponse.status} ${audioResponse.statusText}`);
                }
            } catch (downloadError) {
                console.error('❌ Audio download failed:', downloadError);
                throw new Error(`Audio download failed: ${downloadError.message}`);
            }
        } else if (audioData && typeof audioData === 'object' && audioData.path) {
            // Handle file object with only path (construct URL)
            console.log('✅ Got file object with path, constructing URL...');
            console.log('📁 Audio file path:', audioData.path);
            
            const audioUrl = `${this.settings.server_url}/gradio_api/file=${audioData.path}`;
            console.log('🔗 Constructed audio URL:', audioUrl);
            
            try {
                const audioResponse = await fetch(audioUrl, {
                    headers: {
                        'Referer': `${this.settings.server_url}/?`
                    }
                });
                
                console.log('📡 Audio download response:', audioResponse.status, audioResponse.statusText);
                
                if (audioResponse.ok) {
                    const audioBlob = await audioResponse.blob();
                    console.log('✅ Successfully downloaded audio:', audioBlob.size, 'bytes');
                    
                    // Small delay to prevent rapid-fire requests
                    if (audioBlob.size > 1000) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                    return new Response(audioBlob, {
                        headers: { 'Content-Type': 'audio/wav' }
                    });
                } else {
                    console.error('❌ Failed to download audio file:', audioResponse.status, audioResponse.statusText);
                    throw new Error(`Failed to download audio file: ${audioResponse.status} ${audioResponse.statusText}`);
                }
            } catch (downloadError) {
                console.error('❌ Audio download failed:', downloadError);
                throw new Error(`Audio download failed: ${downloadError.message}`);
            }
        } else if (typeof audioData === 'string') {
            console.log('❌ Got string instead of audio data:', audioData.substring(0, 100));
            throw new Error('Expected audio data but got string. This suggests the API response format changed.');
        } else {
            console.error('🤔 Unexpected audio data format:', audioData);
            console.error('📋 Type:', typeof audioData);
            console.error('📋 Constructor:', audioData?.constructor?.name);
            console.error('📋 Keys:', Object.keys(audioData || {}));
            throw new Error('Unexpected audio data format from MegaTTS3 API');
        }
    }

    async handleQueueWithTimeout(eventId) {
        console.log('Handling queue with timeout approach for event:', eventId);
        console.log('Based on manual testing, TTS takes ~20s. Waiting 30s for completion...');
        
        // Wait 30 seconds (longer than the expected 20s processing time)
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Now try to guess the final file location based on common patterns
        const possibleUrls = [
            `${this.settings.server_url}/gradio_api/file=/tmp/gradio/${eventId}/audio`,
            `${this.settings.server_url}/gradio_api/file=/tmp/gradio/${eventId}/output.wav`,
            `${this.settings.server_url}/gradio_api/file=/tmp/gradio/${eventId}/result.wav`,
            `${this.settings.server_url}/file=/tmp/gradio/${eventId}/audio`,
            `${this.settings.server_url}/file=/tmp/gradio/${eventId}/output.wav`,
            `${this.settings.server_url}/outputs/${eventId}.wav`,
            `${this.settings.server_url}/outputs/${eventId}/audio.wav`
        ];
        
        console.log('Attempting to find generated audio at common locations...');
        
        for (const url of possibleUrls) {
            try {
                console.log('Trying:', url);
                const audioResponse = await fetch(url);
                
                if (audioResponse.ok) {
                    console.log('Found audio at:', url);
                    const audioBlob = await audioResponse.blob();
                    console.log('Audio size:', audioBlob.size, 'bytes');
                    
                    if (audioBlob.size > 1000) { // Sanity check - audio should be substantial
                        return new Response(audioBlob, {
                            headers: { 'Content-Type': 'audio/wav' }
                        });
                    } else {
                        console.log('Audio file too small, trying next location...');
                    }
                } else {
                    console.log('Not found (', audioResponse.status, '):', url);
                }
            } catch (error) {
                console.log('Error trying', url, ':', error.message);
            }
        }
        
        // If direct file guessing fails, fall back to trying some polling
        console.log('Direct file access failed, trying limited polling...');
        return await this.pollQueueResults(eventId, 5); // Only 5 attempts since we already waited
    }

    async handlePredictResponse(result) {
        console.log('Processing /predict API response...');
        console.log('Response structure:', JSON.stringify(result, null, 2));
        
        // Check for direct audio data response (ideal case)
        if (result && result.data && result.data.length > 0) {
            console.log('✅ Direct response with data from /predict!');
            const audioData = result.data[0];
            console.log('📦 Direct audio data type:', typeof audioData);
            console.log('📦 Direct audio data preview:', audioData?.constructor?.name);
            
            // Handle different audio data formats
            if (audioData instanceof Blob) {
                console.log('🎵 Got audio Blob directly:', audioData.size, 'bytes');
                return new Response(audioData, {
                    headers: { 'Content-Type': 'audio/wav' }
                });
            } else if (audioData instanceof ArrayBuffer) {
                console.log('🎵 Got audio ArrayBuffer directly:', audioData.byteLength, 'bytes');
                return new Response(audioData, {
                    headers: { 'Content-Type': 'audio/wav' }
                });
            } else if (typeof audioData === 'string' && audioData.startsWith('data:audio')) {
                console.log('🎵 Got audio data URL, converting to blob...');
                const response = await fetch(audioData);
                const blob = await response.blob();
                return new Response(blob, {
                    headers: { 'Content-Type': 'audio/wav' }
                });
            } else if (typeof audioData === 'string' && audioData.startsWith('/tmp/gradio/')) {
                console.log('🎵 Got file path (fallback), attempting download:', audioData);
                // Fallback: try to download the file with proper headers
                const audioUrl = `${this.settings.server_url}/gradio_api/file=${audioData}`;
                console.log('🔗 Constructed file URL:', audioUrl);
                
                const audioResponse = await fetch(audioUrl, {
                    headers: {
                        'Referer': `${this.settings.server_url}/?`
                    }
                });
                
                if (audioResponse.ok) {
                    const audioBlob = await audioResponse.blob();
                    console.log('✅ Successfully downloaded audio:', audioBlob.size, 'bytes');
                    return new Response(audioBlob, {
                        headers: { 'Content-Type': 'audio/wav' }
                    });
                } else {
                    console.error('❌ File download failed:', audioResponse.status, audioResponse.statusText);
                    throw new Error(`Failed to download audio file: ${audioResponse.status} ${audioResponse.statusText}`);
                }
            } else {
                console.log('🤔 Unexpected audio data format:', audioData);
                console.log('📋 Audio data type:', typeof audioData);
                console.log('📋 Audio data sample:', JSON.stringify(audioData)?.substring(0, 200));
                throw new Error('Unexpected audio data format from MegaTTS3 /predict API');
            }
        } else if (result && result.event_id) {
            // Queue-style response - poll for completion and expect audio data
            console.log(`📋 Queue event ID from /predict: ${result.event_id}`);
            console.log('🔄 Polling for audio data completion...');
            return await this.pollForAudioData(result.event_id);
        } else {
            console.error('❌ Invalid /predict response structure:', result);
            console.error('📋 Expected either result.data with audio or result.event_id');
            throw new Error('Invalid response from MegaTTS3 /predict API: No audio data or event_id received');
        }
    }

    async listenForAudioBytes(eventId, sessionHash) {
        console.log(`🔄 Listening for audio bytes via EventSource (event: ${eventId})...`);
        console.log('⏰ Expected processing time: ~20 seconds for TTS generation');
        
        return new Promise((resolve, reject) => {
            // MegaTTS3 uses EventSource for real-time updates
            const eventSourceUrl = `${this.settings.server_url}/gradio_api/queue/data?session_hash=${sessionHash}`;
            console.log('🎯 Opening EventSource connection:', eventSourceUrl);
            
            const eventSource = new EventSource(eventSourceUrl);
            let timeoutId;
            
            // Set a timeout for the entire operation (2 minutes max)
            const timeout = setTimeout(() => {
                console.error('❌ EventSource timeout after 2 minutes');
                eventSource.close();
                reject(new Error('EventSource timeout: MegaTTS3 did not return audio bytes within 2 minutes'));
            }, 120000);
            
            eventSource.onopen = () => {
                console.log('✅ EventSource connection opened');
            };
            
            eventSource.onmessage = async (event) => {
                try {
                    console.log('📡 EventSource message received:', event.data);
                    const data = JSON.parse(event.data);
                    console.log('📋 Parsed EventSource data:', JSON.stringify(data, null, 2));
                    
                    // Check for completion with audio data
                    if (data.msg === 'process_completed' && data.output && data.output.data) {
                        console.log('🎉 Process completed! Audio data received');
                        clearTimeout(timeout);
                        eventSource.close();
                        
                        const audioData = data.output.data[0];
                        console.log('📦 Audio data from EventSource:', typeof audioData, audioData?.length || audioData?.byteLength || 'unknown size');
                        
                        try {
                            const audioResponse = await this.handleDirectAudioBytes(audioData);
                            resolve(audioResponse);
                        } catch (audioError) {
                            console.error('❌ Failed to process audio bytes:', audioError);
                            reject(audioError);
                        }
                        return;
                    }
                    
                    // Check for alternative completion formats
                    if (data.msg === 'process_completed' || data.success === true) {
                        console.log('✅ Process completed (alternative format)');
                        clearTimeout(timeout);
                        eventSource.close();
                        
                        // Look for audio data in various locations
                        let audioData = null;
                        if (data.output && data.output.data && data.output.data.length > 0) {
                            audioData = data.output.data[0];
                        } else if (data.data && data.data.length > 0) {
                            audioData = data.data[0];
                        } else if (data.result) {
                            audioData = data.result;
                        }
                        
                        if (audioData) {
                            try {
                                const audioResponse = await this.handleDirectAudioBytes(audioData);
                                resolve(audioResponse);
                            } catch (audioError) {
                                reject(audioError);
                            }
                        } else {
                            console.error('❌ Process completed but no audio data found');
                            reject(new Error('Process completed but no audio data found in EventSource response'));
                        }
                        return;
                    }
                    
                    // Check for errors
                    if (data.msg === 'process_failed' || data.error) {
                        console.error('❌ Process failed:', data.error || data.msg);
                        clearTimeout(timeout);
                        eventSource.close();
                        reject(new Error(`MegaTTS3 processing failed: ${data.error || data.msg}`));
                        return;
                    }
                    
                    // Log progress updates
                    if (data.msg === 'process_starts' || data.msg === 'queue_full' || data.msg === 'estimation') {
                        console.log(`📊 Status update: ${data.msg}`, data.rank ? `(queue position: ${data.rank})` : '');
                    }
                    
                } catch (parseError) {
                    console.warn('⚠️ Failed to parse EventSource message:', parseError, 'Raw data:', event.data);
                }
            };
            
            eventSource.onerror = (error) => {
                console.error('❌ EventSource error:', error);
                clearTimeout(timeout);
                eventSource.close();
                reject(new Error('EventSource connection failed'));
            };
            
            // Store reference for cleanup
            timeoutId = timeout;
        });
    }

    async handleDirectAudioData(audioData) {
        console.log('🎵 Processing direct audio data...');
        console.log('📦 Audio data type:', typeof audioData);
        console.log('📦 Audio data preview:', audioData?.constructor?.name);
        
        // Handle different audio data formats
        if (audioData instanceof Blob) {
            console.log('✅ Got audio Blob:', audioData.size, 'bytes');
            return new Response(audioData, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (audioData instanceof ArrayBuffer) {
            console.log('✅ Got audio ArrayBuffer:', audioData.byteLength, 'bytes');
            return new Response(audioData, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (typeof audioData === 'string' && audioData.startsWith('data:audio')) {
            console.log('✅ Got audio data URL, converting...');
            const response = await fetch(audioData);
            const blob = await response.blob();
            return new Response(blob, {
                headers: { 'Content-Type': 'audio/wav' }
            });
        } else if (typeof audioData === 'string' && audioData.startsWith('/tmp/gradio/')) {
            console.log('🔄 Got file path, downloading with Referer header:', audioData);
            const audioUrl = `${this.settings.server_url}/gradio_api/file=${audioData}`;
            
            const audioResponse = await fetch(audioUrl, {
                headers: {
                    'Referer': `${this.settings.server_url}/?`
                }
            });
            
            if (audioResponse.ok) {
                const audioBlob = await audioResponse.blob();
                console.log('✅ Successfully downloaded audio:', audioBlob.size, 'bytes');
                return new Response(audioBlob, {
                    headers: { 'Content-Type': 'audio/wav' }
                });
            } else {
                throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
            }
        } else {
            console.error('🤔 Unexpected audio data format:', audioData);
            throw new Error('Unexpected audio data format from MegaTTS3');
        }
    }

    async pollQueueResults(eventId, maxAttempts = 60) {
        console.log('Polling for queue results (event:', eventId, ')...');
        console.log('Expected processing time: ~20 seconds based on manual testing');
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Since we know it takes ~20s, be more patient early on
                if (attempt <= 10) {
                    console.log('Early polling attempt', attempt, '/60 - allowing time for processing...');
                }
                
                // Try different polling endpoints - focus on gradio_api patterns
                const pollEndpoints = [
                    `/gradio_api/queue/data/${eventId}`,
                    `/gradio_api/queue/status/${eventId}`, 
                    `/gradio_api/queue/${eventId}`,
                    `/queue/data/${eventId}`,
                    `/queue/status/${eventId}`, 
                    `/queue/${eventId}`,
                    `/api/v1/queue/${eventId}`,
                    `/api/queue/${eventId}`,
                    `/run/predict/${eventId}`,
                    `/api/predict/${eventId}`
                ];
                
                console.log('Poll attempt', attempt, '/', maxAttempts, 'for event', eventId);
                
                for (const endpoint of pollEndpoints) {
                    try {
                        const pollUrl = `${this.settings.server_url}${endpoint}`;
                        console.log('Trying poll endpoint:', pollUrl);
                        
                        const pollResponse = await fetch(pollUrl);
                        console.log('Poll response from', endpoint, ':', pollResponse.status, pollResponse.statusText);
                        
                        if (pollResponse.ok) {
                            const pollResult = await pollResponse.json();
                            console.log('Poll result from', endpoint, ':', JSON.stringify(pollResult, null, 2));
                            
                            // Check for completion in various formats
                            if (pollResult.status === 'complete' || 
                                pollResult.success === true ||
                                pollResult.success === 'true' ||
                                (pollResult.data && pollResult.data.length > 0) ||
                                pollResult.output ||
                                pollResult.result) {
                                console.log('Queue processing complete!');
                                return await this.handleQueueResponse(pollResult);
                            } else if (pollResult.status === 'failed' || 
                                      pollResult.error || 
                                      pollResult.success === false) {
                                throw new Error(`Queue processing failed: ${pollResult.error || pollResult.status || 'Unknown error'}`);
                            } else {
                                // Still processing - log status and continue
                                const status = pollResult.status || pollResult.state || 'processing';
                                console.log('Status:', status, ', continuing to poll...');
                                
                                // Found a working endpoint, break to try next poll cycle
                                break;
                            }
                        } else if (pollResponse.status === 404) {
                            // Endpoint doesn't exist, try next one
                            console.log('404 on', endpoint, ', trying next endpoint');
                            continue;
                        } else {
                            console.log(endpoint, 'returned', pollResponse.status, ', trying next endpoint');
                            const errorText = await pollResponse.text();
                            console.log('Error response:', errorText.substring(0, 200));
                            continue;
                        }
                    } catch (pollError) {
                        console.log('Error on', endpoint, ':', pollError.message);
                        continue;
                    }
                }
                
                // If no endpoints worked, we might need to wait longer
                if (attempt <= 20 && attempt % 5 === 0) {
                    console.log(attempt, '/60 attempts completed. MegaTTS3 processing typically takes 20s...');
                }
                
                // Wait before next poll attempt - longer delays for later attempts
                const delay = attempt <= 10 ? 2000 : Math.min(1000 + (attempt * 100), 3000);
                console.log('Waiting', delay, 'ms before next poll attempt...');
                await new Promise(resolve => setTimeout(resolve, delay));
                
            } catch (error) {
                console.warn('Poll attempt', attempt, 'failed:', error.message);
            }
        }
        
        // If we reach here, polling timed out
        console.error('Polling timeout after', maxAttempts, 'attempts (', maxAttempts * 2, '+ seconds) for event', eventId);
        console.error('Suggestion: Check MegaTTS3 gradio interface manually for this event_id');
        throw new Error('Polling timeout: MegaTTS3 server did not respond within expected time');
    }

    async handleQueueResponse(queueResult) {
        // Handle Gradio queue-based response
        console.log('Processing queue response...');
        console.log('Queue result structure:', JSON.stringify(queueResult, null, 2));
        
        // Check multiple possible data locations
        let audioData = null;
        
        if (queueResult.data && queueResult.data.length > 0) {
            audioData = queueResult.data[0];
            console.log('Found audio data in queueResult.data[0]:', audioData);
        } else if (queueResult.output) {
            audioData = queueResult.output;
            console.log('Found audio data in queueResult.output:', audioData);
        } else if (queueResult.result) {
            audioData = queueResult.result;
            console.log('Found audio data in queueResult.result:', audioData);
        } else {
            console.error('Queue response missing data field or data is empty');
            console.error('Full queue result:', queueResult);
            
            // If this is just the initial queue response with event_id, we shouldn't be here
            if (queueResult.event_id) {
                console.log('This appears to be an initial queue response, should have been caught earlier');
                throw new Error('Received initial queue response instead of completed result');
            }
            
            throw new Error('Invalid response from MegaTTS3 server: No audio data received');
        }
        
        if (audioData) {
            let audioUrl;
            
            if (typeof audioData === 'string') {
                // Expected format: "/tmp/gradio/[hash]/audio"
                console.log('Audio data is string path:', audioData);
                
                if (audioData.startsWith('http')) {
                    // Already a full URL
                    audioUrl = audioData;
                } else if (audioData.startsWith('/tmp/gradio/')) {
                    // Gradio temp file - construct the URL as shown in manual testing
                    audioUrl = `${this.settings.server_url}/gradio_api/file=${audioData}`;
                    console.log('Constructed gradio file URL:', audioUrl);
                } else {
                    // Other file path
                    audioUrl = `${this.settings.server_url}/file=${audioData}`;
                }
            } else if (audioData && audioData.url) {
                // If it's a file object with url property
                console.log('Audio data has url property:', audioData.url);
                audioUrl = audioData.url.startsWith('http') ? 
                    audioData.url : 
                    `${this.settings.server_url}${audioData.url}`;
            } else if (audioData && audioData.path) {
                // If it's a file object with path property
                console.log('Audio data has path property:', audioData.path);
                if (audioData.path.startsWith('/tmp/gradio/')) {
                    audioUrl = `${this.settings.server_url}/gradio_api/file=${audioData.path}`;
                } else {
                    audioUrl = `${this.settings.server_url}/file=${audioData.path}`;
                }
            } else if (audioData && audioData.name) {
                // If it's a file object with name property
                console.log('Audio data has name property:', audioData.name);
                audioUrl = `${this.settings.server_url}/file=${audioData.name}`;
            } else {
                console.error('Unexpected audio data format:', audioData);
                console.error('Audio data type:', typeof audioData);
                console.error('Audio data keys:', Object.keys(audioData || {}));
                throw new Error('Unexpected response format from MegaTTS3');
            }
            
            console.log('Fetching generated audio from:', audioUrl);
            
            try {
                const audioResponse = await fetch(audioUrl);
                console.log('Audio fetch response:', audioResponse.status, audioResponse.statusText);
                
                if (!audioResponse.ok) {
                    console.error('Failed to fetch audio:', audioResponse.status, audioResponse.statusText);
                    const errorText = await audioResponse.text();
                    console.error('Error response:', errorText.substring(0, 500));
                    throw new Error(`Failed to fetch generated audio: ${audioResponse.status} ${audioResponse.statusText}`);
                }

                const audioBlob = await audioResponse.blob();
                console.log('Successfully retrieved generated audio! Size:', audioBlob.size, 'bytes');
                
                return new Response(audioBlob, {
                    headers: { 'Content-Type': 'audio/wav' }
                });
            } catch (fetchError) {
                console.error('Error fetching audio:', fetchError);
                throw new Error(`Failed to fetch generated audio: ${fetchError.message}`);
            }
        } else {
            throw new Error('No audio data found in queue response');
        }
    }

    async uploadFileToGradio(filePath) {
        try {
            console.log('Uploading file:', filePath);
            
            // Method 1: Try to fetch the file from file server (port 8000)
            try {
                // Extract just the relative path from assets onwards
                const relativePath = filePath.includes('/assets/') ? 
                    filePath.substring(filePath.indexOf('/assets/')) : 
                    `/assets/voices/${filePath.split('/').pop()}`;
                
                const fileServerUrl = this.settings.server_url.replace(':7929', ':8000') + relativePath;
                console.log('Trying file server:', fileServerUrl);
                
                // Force fresh connection and prevent caching/reuse for NPY files
                const fetchOptions = {
                    method: 'GET',
                    cache: 'no-store',  // Stronger than no-cache
                    headers: {
                        'Cache-Control': 'no-store, no-cache, must-revalidate',
                        'Pragma': 'no-cache',
                        'Connection': 'close',  // Force connection close
                        'X-Requested-With': 'XMLHttpRequest'  // Help identify the request
                    }
                };
                
                // Add unique cache buster to URL for NPY files
                let finalUrl = fileServerUrl;
                if (filePath.endsWith('.npy')) {
                    const cacheBuster = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    finalUrl += `?cb=${cacheBuster}&npy=1`;
                    console.log('NPY file: Using cache-busted URL:', finalUrl);
                }
                
                const fileResponse = await fetch(finalUrl, fetchOptions);
                console.log('File server response:', fileResponse.status, fileResponse.statusText);
                console.log('Response headers:', Array.from(fileResponse.headers.entries()));
                
                if (fileResponse.ok) {
                    console.log('File server access successful');
                    const fileBlob = await fileResponse.blob();
                    console.log('File blob size:', fileBlob.size, 'bytes');
                    
                    // For NPY files, ensure proper MIME type and add delay to prevent connection reuse
                    if (filePath.endsWith('.npy')) {
                        console.log('Processing NPY file - setting application/octet-stream MIME type');
                        const processedBlob = new Blob([fileBlob], { type: 'application/octet-stream' });
                        
                        // Small delay to ensure connection is properly closed
                        console.log('NPY processing delay to ensure clean connection...');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        return await this.uploadBlobToGradio(processedBlob, filePath);
                    } else {
                        return await this.uploadBlobToGradio(fileBlob, filePath);
                    }
                } else {
                    console.warn('File server failed (', fileResponse.status, '):', fileResponse.statusText);
                    throw new Error(`File server returned ${fileResponse.status}`);
                }
            } catch (error) {
                console.warn('File server access failed:', error.message);
                throw new Error(`CORS file access failed: ${error.message}`);
            }
            
        } catch (error) {
            console.error('File upload completely failed:', error);
            throw new Error(`Failed to upload file ${filePath}: ${error.message}`);
        }
    }

    async uploadBlobToGradio(blob, originalPath) {
        try {
            console.log('Uploading blob to Gradio for queue system...');
            console.log('Blob size:', blob.size, 'bytes, type:', blob.type);
            
            const formData = new FormData();
            const fileName = originalPath.split('/').pop();
            formData.append('files', blob, fileName);
            
            // Try the Gradio API upload endpoint (remove deprecated /upload)
            const uploadEndpoints = ['/gradio_api/upload', '/api/upload'];
            
            for (const endpoint of uploadEndpoints) {
                try {
                    console.log('Trying upload endpoint:', endpoint);
                    const uploadResponse = await fetch(`${this.settings.server_url}${endpoint}`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    console.log('Upload response:', uploadResponse.status, uploadResponse.statusText);
                    
                    if (uploadResponse.ok) {
                        const uploadResult = await uploadResponse.json();
                        console.log('File uploaded successfully to Gradio:', uploadResult);
                        
                        // Handle both array and single responses
                        const rawFileData = Array.isArray(uploadResult) ? uploadResult[0] : uploadResult;
                        console.log('Raw Gradio FileData:', JSON.stringify(rawFileData, null, 2));
                        console.log('Raw FileData type:', typeof rawFileData);
                        
                        // Handle case where Gradio returns just a string path
                        let fileData;
                        if (typeof rawFileData === 'string') {
                            console.log('Converting string path to FileData object');
                            fileData = {
                                path: rawFileData,
                                name: fileName,
                                orig_name: fileName,
                                size: blob.size,
                                mime_type: blob.type || (fileName.endsWith('.wav') ? 'audio/x-wav' : 'application/octet-stream')
                            };
                        } else {
                            fileData = rawFileData;
                        }
                        
                        // Ensure the FileData has the required structure
                        const properFileData = {
                            "path": fileData.path || fileData.name,
                            "url": fileData.url || `${this.settings.server_url}/gradio_api/file=${fileData.path || fileData.name}`,
                            "orig_name": fileData.orig_name || fileData.name || fileName,
                            "size": fileData.size || blob.size,
                            "mime_type": fileData.mime_type || blob.type || (fileName.endsWith('.wav') ? 'audio/x-wav' : 'application/octet-stream'),
                            "is_file": true,
                            "meta": {"_type": "gradio.FileData"}
                        };
                        
                        console.log('Processed FileData for queue:', JSON.stringify(properFileData, null, 2));
                        return properFileData;
                    } else {
                        console.warn('Upload endpoint', endpoint, 'failed:', uploadResponse.status);
                        const errorText = await uploadResponse.text();
                        console.warn('Error response:', errorText);
                    }
                } catch (endpointError) {
                    console.warn('Upload endpoint', endpoint, 'error:', endpointError.message);
                }
            }
            
            // No fallback - if upload fails, we should fail
            throw new Error('All Gradio upload endpoints failed');
            
        } catch (error) {
            console.error('Blob upload failed:', error);
            throw error;
        }
    }

    async readLocalFile(filePath) {
        // This method attempts to read a local file
        // Note: This will only work if the browser has access to the file system
        // which is generally not possible for security reasons
        throw new Error('Local file system access not available in browser');
    }

    async generateWithCli(text, voiceId) {
        // CLI-based generation would require a backend service to execute Python commands
        // This is a placeholder for CLI integration
        throw new Error('CLI integration not implemented. Please use Gradio API mode.');
    }

    dispose() {
        // Clean up any pending requests
        this.pendingRequests.clear();
    }
}