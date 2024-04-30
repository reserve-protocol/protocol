import { ITokens } from "#/common/configuration"
import fs from "fs"

export interface Whales {
  [key: string]: string
}
export interface Updated {
  [key: string]: string
}

export interface NetworkWhales {
    tokens: Whales
    lastUpdated: Updated
}

export function getWhalesFileName(chainId: string | number): string {
  return `./tasks/validation/whales/whales_${chainId}.json`
}

export function getWhalesFile(chainId: string | number): NetworkWhales {
  const whalesFile = getWhalesFileName(chainId)
  const whales: NetworkWhales = JSON.parse(fs.readFileSync(whalesFile, 'utf8'))
  return whales
}