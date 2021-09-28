import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../../common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AbstractERC20, AbstractRToken, Account, Component, Simulation, Token } from "../interface"

export class Implementation0 implements Simulation {
    rToken: RToken

    constructor(owner: Account, rTokenName: string, rTokenSymbol: string, tokens: Token[]) {
        this.rToken = new RToken(owner, rTokenName, rTokenSymbol, tokens)
    }
}

class Base implements Component {
    // @ts-ignore
    _signer: Account

    connect(sender: Account): this {
        this._signer = sender
        return this
    }
}

class ERC20 extends Base implements AbstractERC20 {
    owner: Account
    name: string
    symbol: string
    balances: Map<Account, BigNumber> // address -> balance
    allowances: Map<Account, BigNumber> // address -> allowance

    constructor(owner: Account, name: string, symbol: string) {
        super()
        this.owner = owner
        this.name = name
        this.symbol = symbol
        this.balances = new Map<Account, BigNumber>()
        this.allowances = new Map<Account, BigNumber>()
    }

    async balanceOf(account: Account): Promise<BigNumber> {
        return this.balances.get(account) || ZERO
    }

    async mint(account: Account, amount: BigNumber): Promise<void> {
        const bal = await this.balanceOf(account)
        this.balances.set(account, bal.add(amount))
    }

    async burn(account: Account, amount: BigNumber): Promise<void> {
        const bal = await this.balanceOf(account)
        if (bal.sub(amount).lt(ZERO)) {
            throw new Error("Cannot burn more than available balance")
        }
        this.balances.set(account, bal.sub(amount))
    }

    async transfer(to: Account, amount: BigNumber): Promise<void> {
        const fromBal = await this.balanceOf(this._signer)
        const toBal = await this.balanceOf(to)
        if (fromBal.lt(amount)) {
            throw new Error("Cannot transfer more than available balance")
        }
        this.balances.set(this._signer, fromBal.sub(amount))
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

class RToken extends ERC20 implements AbstractRToken {
    ADDRESS = "RTOKEN_ADDRESS"
    basket: Basket

    constructor(owner: Account, name: string, symbol: string, tokens: Token[]) {
        super(owner, name, symbol)
        const erc20s = tokens.map((t) => new ERC20(owner, t.name, t.symbol))
        this.basket = new Basket(tokens, erc20s)
    }

    basketERC20(index: number): ERC20 {
        return this.basket.erc20s[index]
    }

    async issue(amount: BigNumber): Promise<void> {
        for (let i = 0; i < this.basket.size; i++) {
            const amt = this.basket.getAdjustedQuantity(i).mul(amount).div(pow10(18))
            const basketERC20 = await this.basketERC20(i)
            await basketERC20.connect(this._signer).transfer(Account.RToken, amt)
        }
        this.mint(this._signer, amount)
    }

    async redeem(amount: BigNumber): Promise<void> {
        this.burn(this._signer, amount)
        for (let i = 0; i < this.basket.size; i++) {
            const amt = this.basket.getAdjustedQuantity(i).mul(amount).div(pow10(18))
            const basketERC20 = await this.basketERC20(i)
            await basketERC20.connect(Account.RToken).transfer(this._signer, amt)
        }
    }
}
