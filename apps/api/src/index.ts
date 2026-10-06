import 'dotenv/config'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { createMarketDataRouter } from './routes/market-data.js'

const port = Number(process.env.PORT ?? 3001)
const corsOriginEnv =
  process.env.CORS_ORIGIN ??
  'http://localhost:5173,http://localhost:5174,https://optionmarkettraders.com,https://www.optionmarkettraders.com'
const corsOrigins = corsOriginEnv.split(',').map((value) => value.trim()).filter(Boolean)

const app = express()

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
  }),
)
app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

app.use('/market-data', createMarketDataRouter())

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
