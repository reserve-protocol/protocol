import axios from 'axios'

type CoingeckoDataPoints = {
  prices: [number, number][]
  market_caps: [number, number][]
  total_volumes: [number, number][]
}

const API = 'https://api.coingecko.com/api/v3'

const getCoingeckoDataPoints = async (
  coin: string,
  currency: string,
  from: number,
  to: number
): Promise<CoingeckoDataPoints> =>
  (
    await axios.get(
      `${API}/coins/${coin}/market_chart/range?vs_currency=${currency}&from=${from}&to=${to}`
    )
  ).data

export const getCoingeckoSimplePrice = async (coin: string, currency: string): Promise<number> =>
  (await axios.get(`${API}/simple/price?ids=${coin}&vs_currencies=${currency}`)).data as number

export const getCoingeckoSimpleTokenPrice = async (
  tokenAddr: string,
  currency: string
): Promise<number> =>
  (
    await axios.get(
      `${API}/simple/token_price/ethereum?contract_addresses=${tokenAddr}&vs_currencies=${currency}`
    )
  ).data as number

export const getLastPrice = async (
  coin: string,
  currency: string,
  from: number,
  to: number
): Promise<number> => (await getCoingeckoDataPoints(coin, currency, from, to)).prices[0][1]
