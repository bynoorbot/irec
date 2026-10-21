# Aura Home Transcript Runner

A lightweight, self-hosted transcript proxy service running on a residential IP to fetch YouTube transcripts where cloud egress (e.g. Google Cloud Run) encounters YouTube botwalls.

Exposed securely to the Aura backend via Cloudflare Tunnel.

---

## 1. Quickstart (Run by Hand)

```bash
# 1. Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start service (RUNNER_TOKEN is mandatory)
export RUNNER_TOKEN="your-secure-secret-token"
export RUNNER_PORT=8791
python server.py
```

The service will listen on `127.0.0.1:8791` by default.

---

## 2. Systemd Service Installation (User Unit)

1. Create the environment file at `~/.config/ytr-runner.env`:
   ```bash
   cat << 'EOF' > ~/.config/ytr-runner.env
   RUNNER_TOKEN=your-secure-secret-token
   RUNNER_HOST=127.0.0.1
   RUNNER_PORT=8791
   EOF
   chmod 600 ~/.config/ytr-runner.env
   ```

2. Link and enable the systemd service:
   ```bash
   mkdir -p ~/.config/systemd/user
   cp systemd/ytr-runner.service ~/.config/systemd/user/ytr-runner.service
   systemctl --user daemon-reload
   systemctl --user enable --now ytr-runner.service
   ```

3. Check logs:
   ```bash
   journalctl --user -u ytr-runner.service -f
   ```

---

## 3. Cloudflare Tunnel Configuration

> [!NOTE]
> We recommend Cloudflare's official `cloudflared service install <token>` command rather than a custom systemd unit, as it properly manages tunnel lifecycle and auto-updates.

1. **Create the Tunnel**:
   - In Cloudflare Zero Trust Dashboard, navigate to **Networks** -> **Tunnels** -> **Create a tunnel**.
   - Select `cloudflared`, follow the installer instructions on the host:
     ```bash
     sudo cloudflared service install <TUNNEL_TOKEN>
     ```
   - In the **Public Hostnames** tab, route your subdomain (e.g., `runner.aura.internal` or `ytr.yourdomain.com`) to:
     - Type: `HTTP`
     - URL: `127.0.0.1:8791`

2. **Access Security / Tokens**:
   - Use the `X-Runner-Token` header for backend-to-runner authentication.
   - If Cloudflare Access is enabled in front of the tunnel, generate a **Service Token** in **Access** -> **Service Auth**, and pass the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

---

## 4. Verification `curl` Commands

### Health check (no auth required)
```bash
curl -s http://127.0.0.1:8791/health | jq .
# Expected: {"status":"ok","version":"<sha or dev>"}
```

### Unauthorized request (verifies token protection)
```bash
curl -i "http://127.0.0.1:8791/transcript?v=dQw4w9WgXcQ"
# Expected: HTTP/1.1 401 Unauthorized
# Body: {"error_code":"UNAUTHORIZED"}
```

### Invalid video ID (input validation)
```bash
curl -i -H "X-Runner-Token: your-secure-secret-token" "http://127.0.0.1:8791/transcript?v=invalid_id"
# Expected: HTTP/1.1 400 Bad Request
# Body: {"error":"Invalid video ID. Expected 11 alphanumeric/dash/underscore characters.","error_code":"INVALID_VIDEO_ID"}
```

### Valid transcript fetch
```bash
curl -i -H "X-Runner-Token: your-secure-secret-token" "http://127.0.0.1:8791/transcript?v=dQw4w9WgXcQ"
# Expected: HTTP/1.1 200 OK
# Body: {"transcript":"...","length":1234,"lang":"en"}
```

---

## 5. Running Tests

Test dependencies (`pytest`, `httpx`) are listed in `tests/requirements-dev.txt`:
```bash
pip install -r tests/requirements-dev.txt
pytest tests/ -v
```
