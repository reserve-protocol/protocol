import axios from 'axios'

type CoingeckoDataPoints = {
  prices: [number, number][]
  market_caps: [number, number][]
  total_volumes: [number, number][]
}

const getCoingeckoDataPoints = async (
  coin: string,
  currency: string,
  from: number,
  to: number
): Promise<CoingeckoDataPoints> => {
  const coingeckoDatapoints = (
    await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coin}/market_chart/range?vs_currency=${currency}&from=${from}&to=${to}`
    )
  ).data as CoingeckoDataPoints
  return coingeckoDatapoints
}

const getCoingeckoSimplePrice = async (coin: string, currency: string): Promise<number> => {
  const getCoingeckoSimplePrice = (
    await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${currency}`
    )
  ).data as number
  return getCoingeckoSimplePrice
}

const getCoingeckoSimpleTokenPrice = async (
  tokenAddr: string,
  currency: string
): Promise<number> => {
  const getCoingeckoSimpleTokenPrice = (
    await axios.get(
      `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddr}&vs_currencies=${currency}`
    )
  ).data as number
  return getCoingeckoSimpleTokenPrice
}

export const getLastPrice = async (
  coin: string,
  currency: string,
  from: number,
  to: number
): Promise<number> => {
  const coingeckoDataPoints = await getCoingeckoDataPoints(coin, currency, from, to)
  return coingeckoDataPoints.prices[0][1]
}
