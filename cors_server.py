#!/usr/bin/env python3
"""
CORS-enabled file server for MegaTTS3 voice files
Allows SillyTavern to access voice files across origins
"""

import http.server
import socketserver
import os
from urllib.parse import unquote

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.cors_headers_sent = False
        super().__init__(*args, **kwargs)
    
    def send_cors_headers(self):
        """Send CORS headers only once per request"""
        if not self.cors_headers_sent:
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma')
            self.send_header('Access-Control-Max-Age', '86400')
            self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Type')
            self.cors_headers_sent = True
            print(f"📤 CORS headers sent for: {self.path}")

    def do_OPTIONS(self):
        """Handle preflight requests"""
        print(f"🔄 OPTIONS preflight request: {self.path}")
        print(f"📋 Origin: {self.headers.get('Origin', 'No Origin header')}")
        
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        try:
            # Log the request for debugging
            print(f"🌐 CORS GET request: {self.path}")
            print(f"📋 Origin: {self.headers.get('Origin', 'No Origin header')}")
            print(f"📋 User-Agent: {self.headers.get('User-Agent', 'No User-Agent')[:50]}...")
            
            # Reset CORS flag for each request
            self.cors_headers_sent = False
            
            # Send response with CORS headers
            super().do_GET()
            
        except Exception as e:
            print(f"❌ Error handling request {self.path}: {e}")
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(f"Server error: {e}".encode())

    def do_HEAD(self):
        """Handle HEAD requests with CORS"""
        print(f"🔍 HEAD request: {self.path}")
        self.cors_headers_sent = False
        super().do_HEAD()

    def send_response(self, code, message=None):
        # Call parent first, then add CORS
        super().send_response(code, message)
        
    def end_headers(self):
        # Add CORS headers before ending, but only if not already sent
        self.send_cors_headers()
        super().end_headers()
        
        # Flush the response to prevent any buffering issues
        try:
            self.wfile.flush()
        except:
            pass

    def log_message(self, format, *args):
        # Enhanced logging
        print(f"🔄 {self.address_string()} - [{self.log_date_time_string()}] {format % args}")

def main():
    PORT = 8000
    
    # Change to MegaTTS3 directory to serve files
    os.chdir('/home/user1/MegaTTS3')
    print(f"📁 Serving files from: {os.getcwd()}")
    print(f"🌐 CORS-enabled file server starting on port {PORT}")
    print(f"🎯 Voice files should be accessible at: http://10.0.0.20:{PORT}/assets/voices/")
    print()
    
    # Test if voice files exist
    voice_dir = 'assets/voices'
    if os.path.exists(voice_dir):
        files = os.listdir(voice_dir)
        print(f"✅ Found voice directory with {len(files)} files:")
        for file in files:
            file_path = os.path.join(voice_dir, file)
            file_size = os.path.getsize(file_path)
            print(f"   📄 {file} ({file_size} bytes)")
    else:
        print(f"❌ Warning: Voice directory '{voice_dir}' not found!")
    print()
    
    # Start server
    try:
        with socketserver.TCPServer(("", PORT), CORSHTTPRequestHandler) as httpd:
            print(f"🚀 Server running at http://10.0.0.20:{PORT}/")
            print("🔍 Test URLs:")
            print(f"   Audio: http://10.0.0.20:{PORT}/assets/voices/Diablo.wav")
            print(f"   NPY:   http://10.0.0.20:{PORT}/assets/voices/Diablo.npy")
            print()
            print("Press Ctrl+C to stop the server")
            print("=" * 60)
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n🛑 Server stopped by user")
    except Exception as e:
        print(f"❌ Server error: {e}")

if __name__ == "__main__":
    main()