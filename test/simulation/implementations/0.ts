import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../../common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AbstractERC20, Address, Basket, AbstractImplementation, Token } from "../interface"

export class Implementation0 implements AbstractImplementation {
    rToken: ERC20
    basket: SimpleBasket

    constructor(rTokenName: string, rTokenSymbol: string, tokens: Token[]) {
        this.rToken = new ERC20(rTokenName, rTokenSymbol)
        const tokenMap = new Map<Token, ERC20>()
        for (let token of tokens) {
            tokenMap.set(token, new ERC20(token.name, token.symbol))
        }
        this.basket = new SimpleBasket(tokenMap)
    }

    issue(account: Address, amount: BigNumber): void {
        for (let token of this.basket.erc20s.keys()) {
            const amt = this.basket.getAdjustedQuantity(token).mul(amount).div(pow10(18))
            this.basket.erc20(token).transfer(account, this.rToken.address, amt)
        }
        this.rToken.mint(account, amount)
    }

    redeem(account: Address, amount: BigNumber): void {
        this.rToken.burn(account, amount)
        for (let token of this.basket.erc20s.keys()) {
            const amt = this.basket.getAdjustedQuantity(token).mul(amount).div(pow10(18))
            this.basket.erc20(token).transfer(this.rToken.address, account, amt)
        }
    }
}

export class SimpleBasket implements Basket {
    scalarE18: BigNumber // a float multiplier expressed relative to 1e18
    erc20s: Map<Token, ERC20>

    constructor(erc20s: Map<Token, ERC20>) {
        this.scalarE18 = pow10(18)
        this.erc20s = erc20s
    }

    getAdjustedQuantity(token: Token): BigNumber {
        return token.quantityE18.mul(this.scalarE18).div(pow10(18))
    }

    erc20(token: Token): ERC20 {
        if (!this.erc20s.has(token)) {
            throw new Error("Token not in basket")
        }
        return <ERC20>this.erc20s.get(token)
    }
}

export class ERC20 implements AbstractERC20 {
    address: Address
    name: string
    symbol: string
    balances: Map<Address, BigNumber> // address -> balance
    allowances: Map<Address, BigNumber> // address -> allowance

    constructor(name: string, symbol: string) {
        this.address = ethers.Wallet.createRandom().address
        this.name = name
        this.symbol = symbol
        this.balances = new Map<Address, BigNumber>()
        this.allowances = new Map<Address, BigNumber>()
    }

    balanceOf(account: Address): BigNumber {
        return this.balances.get(account) || ZERO
    }

    mint(account: Address, amount: BigNumber): void {
        const bal = this.balanceOf(account)
        this.balances.set(account, bal.add(amount))
    }

    burn(account: Address, amount: BigNumber): void {
        const bal = this.balanceOf(account)
        if (bal.sub(amount).lt(ZERO)) {
            throw new Error("Cannot burn more than available balance")
        }
        this.balances.set(account, bal.sub(amount))
    }

    transfer(from: Address, to: Address, amount: BigNumber): void {
        const fromBal = this.balanceOf(from)
        const toBal = this.balanceOf(to)
        if (fromBal.lt(amount)) {
            throw new Error("Cannot transfer more than available balance")
        }
        this.balances.set(from, fromBal.sub(amount))
        this.balances.set(to, toBal.add(amount))
    }
}
