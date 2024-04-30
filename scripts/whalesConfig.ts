import { ITokens } from "#/common/configuration"
import fs from "fs"

export interface Whales extends ITokens {}
export interface Updated extends ITokens {}

export interface NetworkWhales {
    tokens: Whales
    lastUpdated: Updated
}

export function getWhalesFile(chainId: string | number): NetworkWhales {
  const whalesFile = `./tasks/validation/whales/whales_${chainId}.json`
  const whales: NetworkWhales = JSON.parse(fs.readFileSync(whalesFile, 'utf8'))
  return whales
}