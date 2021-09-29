import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../../common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Account, Command, Contract, Simulation, State, Token, User } from "../interface"

export class Implementation0 implements Simulation {
    // @ts-ignore
    owner: User // @ts-ignore
    rToken: RToken

    async seed(state: State): Promise<void> {
        this.owner = state.owner
        this.rToken = new RToken(state)
    }

    // Interprets a Command as a function call, optionally originating from an account.
    async execute(command: Command): Promise<any> {
        const key = Object.keys(command)[0]
        const subtree = command[key as keyof Command]
        const func = Object.keys(subtree as Object)[0]
        // @ts-ignore
        const args = subtree[func] // @ts-ignored
        return await this[key][func](...args)
    }

    async state(): Promise<State> {
        return {
            owner: this.owner,
            rToken: {
                basket: this.rToken.basket.tokens,
                balances: this.rToken.balances,
            },
        }
    }
}



class ERC20 {
    name: string
    symbol: string
    balances: Map<Account, BigNumber>

    constructor(owner: User, name: string, symbol: string, fund?: boolean) {
        this.name = name
        this.symbol = symbol
        this.balances = new Map<Account, BigNumber>()
        if (fund) {
            this.balances.set(owner, pow10(36))
        }
    }

    balanceOf(account: Account): BigNumber {
        return this.balances.get(account) || ZERO
    }

    mint(account: Account, amount: BigNumber): void {
        const bal = this.balanceOf(account)
        this.balances.set(account, bal.add(amount))
    }

    burn(account: Account, amount: BigNumber): void {
        const bal = this.balanceOf(account)
        if (bal.sub(amount).lt(ZERO)) {
            throw new Error("Cannot burn more than available balance")
        }
        this.balances.set(account, bal.sub(amount))
    }

    transfer(from: Account, to: Account, amount: BigNumber): void {
        const fromBal = this.balanceOf(from)
        const toBal = this.balanceOf(to)
        if (fromBal.lt(amount)) {
            throw new Error("Cannot transfer more than available balance")
        }
        this.balances.set(from, fromBal.sub(amount))
        this.balances.set(to, toBal.add(amount))
    }
}

class Basket {
    scalarE18: BigNumber // a float multiplier expressed relative to 1e18
    tokens: Token[]
    erc20s: ERC20[]
    size: number

    constructor(tokens: Token[], erc20s: ERC20[]) {
        this.scalarE18 = pow10(18)
        this.tokens = tokens
        this.erc20s = erc20s
        this.size = this.erc20s.length
    }

    getAdjustedQuantity(index: number): BigNumber {
        return this.tokens[index].quantityE18.mul(this.scalarE18).div(pow10(18))
    }
}

class RToken extends ERC20 {
    basket: Basket

    constructor(state: State) {
        super(state.owner, "Reserve", "RSV")
        const erc20s = state.rToken.basket.map((token) => new ERC20(state.owner, token.name, token.symbol, true))
        this.basket = new Basket(state.rToken.basket, erc20s)
    }

    issue(account: Account, amount: BigNumber): void {
        for (let i = 0; i < this.basket.size; i++) {
            const amt = this.basket.getAdjustedQuantity(i).mul(amount).div(pow10(18))
            this.basket.erc20s[i].transfer(account, Contract.RToken, amt)
        }
        this.mint(account, amount)
    }

    redeem(account: Account, amount: BigNumber): void {
        this.burn(account, amount)
        for (let i = 0; i < this.basket.size; i++) {
            const amt = this.basket.getAdjustedQuantity(i).mul(amount).div(pow10(18))
            this.basket.erc20s[i].transfer(Contract.RToken, account, amt)
        }
    }
}
