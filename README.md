# MegaTTS3 + SillyTavern Integration

A complete integration allowing **ByteDance's MegaTTS3** voice cloning model to work seamlessly with **SillyTavern** for character voice synthesis.

> ⚠️ **Important Note**: This integration was created as a proof-of-concept but is **not recommended for production use** due to MegaTTS3's excessive VRAM requirements (6.5GB+). Consider **Kokoro TTS** (0.7GB VRAM) or other efficient alternatives for practical use.

## 🎯 What This Does

- **Voice Cloning**: Use ByteDance's collection of **hundreds of pre-processed voices** for speech in SillyTavern
- **Pre-made Voices Only**: Access to ByteDance's voice collection (~5.7GB) - **custom voices not supported**
- **Auto-Discovery**: Automatically detects available voices from your voice directory
- **Real-time TTS**: Generate character voices on-demand during conversations
- **CORS Support**: Handles cross-origin requests between SillyTavern and MegaTTS3

## 📊 Performance Reality Check

| Model | VRAM Usage | Speed | Quality | Voice Cloning | Recommendation |
|-------|------------|-------|---------|---------------|----------------|
| **fish-speech** | ~2GB | 5s | Excellent | ✅ **Custom voices** | ✅ **Best choice** |
| **XTTSv2** | ~2GB | 5s | Very Good | ✅ Custom voices | ✅ Good alternative |
| **Kokoro TTS** | ~Minimal | 3s | Excellent | ❌ No voice cloning | ⚠️ Quality but no cloning |
| **MegaTTS3** | 6.5GB+ | 10-20s | Excellent | ❌ Pre-made only | ❌ Wasteful & limited |

*fish-speech offers **voice cloning with custom voices** at only ~2GB VRAM!*

## 🚨 Why You Probably Shouldn't Use This

**MegaTTS3 is a diffusion-based model** (like Stable Diffusion for audio) with major limitations:
- **Massive VRAM usage**: 6.5GB minimum, up to 10GB during inference  
- **Slow generation**: 32 denoising steps per audio clip
- **Memory leaks**: Gradio doesn't properly clean up between requests
- **No custom voice cloning**: ByteDance didn't open-source latent extraction - only their voice collection works
- **Overkill complexity**: Simpler models like fish-speech achieve better voice cloning with 3x less VRAM

**Better alternatives:**
- **[fish-speech](https://github.com/fishaudio/fish-speech)**: ~2GB VRAM, **excellent voice cloning with custom voices**, quality on par with Kokoro
- **[XTTSv2](https://github.com/coqui-ai/TTS)**: ~2GB VRAM, voice cloning support, proven stable
- **[Kokoro TTS](https://huggingface.co/hexgrad/Kokoro-82M)**: Almost no VRAM, **top TTS quality**, but no voice cloning
- **[ElevenLabs](https://elevenlabs.io/)**: Cloud-based voice cloning, no local resources needed

## 📋 Prerequisites

- **Python 3.10** (required for MegaTTS3)
- **CUDA GPU** with 8GB+ VRAM (6.5GB minimum for MegaTTS3)
- **Storage**: ~6GB free space (for ByteDance's voice collection)
- **SillyTavern** installed and running
- **Git** and **Conda/Miniconda**

## 🛠️ Installation Guide

### Step 1: Install MegaTTS3

```bash
# Clone MegaTTS3
git clone https://github.com/bytedance/MegaTTS3.git
cd MegaTTS3

# Create conda environment
conda create -n megatts3-env python=3.10
conda activate megatts3-env

# Install dependencies
pip install -r requirements.txt
conda install -y -c conda-forge pynini==2.1.5
pip install WeTextProcessing==1.0.3

# Install PyTorch for your CUDA version
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126

# Set environment variable
export PYTHONPATH="$(pwd):$PYTHONPATH"
```

### Step 2: Download Models

```bash
# Download MegaTTS3 checkpoints
huggingface-cli download ByteDance/MegaTTS3 --local-dir ./checkpoints --local-dir-use-symlinks False
```

### Step 3: Install SillyTavern Provider

1. **Download the provider files** from this repository
2. **Place `megatts3-provider.js` and `index.js`** in your SillyTavern public/scripts/extensions/tts directory
3. **Configure SillyTavern**:
   - Go to Extensions → TTS
   - Select "MegaTTS3" as your TTS provider
   - Configure settings (see Configuration section)

### Step 4: Download Voice Files

⚠️ **Important**: You **cannot create custom voices** - ByteDance did not open-source the latent preprocessing scripts. You must use their pre-made collection.

#### Download ByteDance's Pre-made Voice Collection (Only Option)

ByteDance provides **hundreds of pre-processed voice pairs** - this is your only option:

```bash
# Create voice directory
mkdir -p /home/user/MegaTTS3/assets/voices

# Download from ByteDance's official collection
# URL: https://drive.google.com/drive/folders/1QhcHWcy20JfqWjgqZX1YM3I6i9u4oNlr
# Size: ~5.7GB total (hundreds of voices)
# Contains: Both .wav and .npy files pre-processed and ready to use
```

**To download:**
1. Visit: https://drive.google.com/drive/folders/1QhcHWcy20JfqWjgqZX1YM3I6i9u4oNlr
2. Select the voices you want (or download all ~5.7GB)
3. Extract to `/home/user/MegaTTS3/assets/voices/`

**Why only pre-made voices:**
- ❌ ByteDance didn't open-source the latent extraction code
- ❌ `.npy` files cannot be generated from custom `.wav` files
- ❌ No way to use your own voice samples
- ✅ Only ByteDance's collection works

### Step 5: Start Services

#### Terminal 1: CORS Server (for voice discovery)
```bash
cd /home/user/MegaTTS3
python cors_server.py
# Should start on http://localhost:8000
```

#### Terminal 2: MegaTTS3 Server
```bash
cd /home/user/MegaTTS3
conda activate megatts3-env
python -m tts.gradio_api
# Should start on http://localhost:7929
```

## ⚙️ Configuration

### SillyTavern TTS Settings

1. **Server URL**: `http://localhost:7929` (MegaTTS3 Gradio server)
2. **Voice Directory**: `/home/user/MegaTTS3/assets/voices` (absolute path)
3. **Auto-discover voices**: ✅ Enabled (requires CORS server)
4. **Default Voice**: Name of your primary voice (without file extension)

## 🐛 Troubleshooting

### Common Issues

#### "CUDA out of memory" 
- **Cause**: MegaTTS3 needs 6.5GB+ VRAM
- **Solution**: Close other GPU applications, or use CPU mode (very slow):
  ```bash
  CUDA_VISIBLE_DEVICES="" python -m tts.gradio_api
  ```

#### "No voices found"
- **Cause**: CORS server not running or voice files missing
- **Quick Solution**: Download ByteDance's pre-made voices (5.7GB): https://drive.google.com/drive/folders/1QhcHWcy20JfqWjgqZX1YM3I6i9u4oNlr
- **Check**: 
  1. CORS server running on port 8000
  2. Voice files extracted to `/home/user/MegaTTS3/assets/voices`
  3. Both .wav AND .npy files exist for each voice (only from ByteDance collection)
  4. Voice directory path is correct in SillyTavern settings

#### "403 Forbidden" errors
- **Cause**: CORS issues between SillyTavern and servers
- **Solution**: Ensure CORS server is running and accessible

#### "Audio generation failed"
- **Cause**: Various MegaTTS3 internal errors
- **Debug**: Check MegaTTS3 console output for specific errors

## 🔧 Development

### File Structure
```
your-repo/
├── megatts3-provider.js    # SillyTavern TTS provider
├── cors_server.py          # CORS-enabled file server
├── index.js                # Integrates `megatts3` with SillyTavern
└── README.md               # This file
```

### Customization

The provider supports:
- **Auto voice discovery**: Scans voice directory for .wav/.npy pairs
- **Manual voice refresh**: Button to reload voices without restart
- **Parameter adjustment**: Real-time tuning of voice parameters
- **Error handling**: Graceful fallbacks and user feedback

## 🤝 Contributing

Found a bug or improvement? Please open an issue! However, keep in mind:

1. **This is primarily a proof-of-concept**
2. **MegaTTS3's resource requirements make it impractical**
3. **Consider contributing to more efficient TTS integrations instead**

## 📄 License

- **This integration code**: MIT License
- **MegaTTS3**: Apache-2.0 License (ByteDance)
- **SillyTavern**: AGPL-3.0 License

## 🙏 Acknowledgments

- **ByteDance** for MegaTTS3 model
- **SillyTavern team** for the excellent platform
- **Community** for testing and feedback

## ⚠️ Final Recommendation

**For voice cloning, use fish-speech instead of this integration.** fish-speech offers:
- **Excellent voice cloning** with custom voices (unlike MegaTTS3's pre-made-only limitation)
- **Only ~2GB VRAM** vs MegaTTS3's 6.5GB+ (3x more efficient!)
- **Quality on par with top TTS models**
- **Much better stability** and easier setup

**For general TTS (no voice cloning needed)**: Use Kokoro TTS for top quality with minimal VRAM.

This MegaTTS3 integration was an interesting experiment, but **fish-speech proves you can have excellent voice cloning with reasonable resources** - making resource-heavy, limited diffusion models like MegaTTS3 completely obsolete.

---

*Made with frustration and determination by someone who learned that diffusion models are overkill for TTS* 😅
