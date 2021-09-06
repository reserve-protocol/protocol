import { expect } from "chai"
import { ethers } from "hardhat"
import { BN_SCALE_FACTOR } from "../common/constants"
import { bn, fp } from "../common/numbers"
import { ERC20Mock } from "../typechain/ERC20Mock.d"
import { ContractFactory } from "ethers"
import { BigNumberish } from "ethers"
import { BasketCallerMock } from "../typechain/BasketCallerMock.d"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

const genesisQty_half = BN_SCALE_FACTOR.div(2)
const genesisQty_third = BN_SCALE_FACTOR.div(3)

const inflationSinceGenesis_10 = BN_SCALE_FACTOR.add(BN_SCALE_FACTOR.div(10))

const fp_10 = fp(10)

interface ITokenInfo {
    tokenAddress: string
    genesisQuantity: BigNumberish
    rateLimit: BigNumberish
    maxTrade: number
    priceInRToken: BigNumberish
    slippageTolerance: BigNumberish
}

describe("Basket library", () => {
    let ERC20: ContractFactory
    let tokenInfo0: ITokenInfo
    let tokenInfo1: ITokenInfo
    let BasketCaller: ContractFactory
    let caller: BasketCallerMock
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let other: SignerWithAddress

    // aux function - deploys a token and sets the tokenInfo
    const createToken = async (
        name: string,
        symbol: string,
        genesisQuantity: BigNumberish
    ): Promise<ITokenInfo> => {
        const tkn = await (<Promise<ERC20Mock>>ERC20.deploy(name, symbol))
        const tokenInfo = {
            tokenAddress: tkn.address,
            genesisQuantity,
            rateLimit: fp_10,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0,
        }

        return tokenInfo
    }

    beforeEach(async () => {
        ;[owner, addr1, addr2, other] = await ethers.getSigners()

        // Create Tokens
        ERC20 = await ethers.getContractFactory("ERC20Mock")

        // Create Token 1
        tokenInfo0 = await createToken("Token1", "TKN1", genesisQty_half)

        // Create Token 2
        tokenInfo1 = await createToken("Token2", "TKN2", genesisQty_third)

        // Setup Basket
        BasketCaller = await ethers.getContractFactory("BasketCallerMock")
        caller = await (<Promise<BasketCallerMock>>BasketCaller.deploy([tokenInfo0, tokenInfo1]))
    })

    describe("Tokens", () => {
        const expectTokenInfo = async (index: number, tokenInfo: Partial<ITokenInfo>) => {
            const { tokenAddress, genesisQuantity, rateLimit } = await caller.getTokenInfo(index)

            expect(tokenAddress).to.equal(tokenInfo.tokenAddress)
            expect(genesisQuantity).to.equal(tokenInfo.genesisQuantity)
            expect(rateLimit).to.equal(tokenInfo.rateLimit)
        }

        it("Should setup initial values correctly", async () => {
            expect(await caller.getBasketSize()).to.equal(2)
            expect(await caller.getInflationSinceGenesis()).to.equal(BN_SCALE_FACTOR)

            // Token at 0
            expectTokenInfo(0, {
                tokenAddress: tokenInfo0.tokenAddress,
                genesisQuantity: genesisQty_half.toString(),
                rateLimit: fp_10.toString(),
            })

            // Token at 1
            expectTokenInfo(1, {
                tokenAddress: tokenInfo1.tokenAddress,
                genesisQuantity: genesisQty_third.toString(),
                rateLimit: fp_10.toString(),
            })
        })

        it("Should allow to remove/add tokens", async () => {
            // Create Token at 2
            const tokenInfo2 = await createToken("Token3", "TKN3", genesisQty_third)

            // Create Token at 3
            const tokenInfo3 = await createToken("Token4", "TKN4", genesisQty_half)

            // Remove Token at 0 from basket
            tokenInfo0.genesisQuantity = bn(0)

            // Update quantity for Token at 1
            tokenInfo1.genesisQuantity = genesisQty_half.toString()

            // Set Tokens
            await caller.setTokens([tokenInfo0, tokenInfo1, tokenInfo2, tokenInfo3])

            // Check Basket is properly set
            expect(await caller.getBasketSize()).to.equal(4)
            expect(await caller.getInflationSinceGenesis()).to.equal(BN_SCALE_FACTOR)

            // Token at 0
            expectTokenInfo(0, {
                tokenAddress: tokenInfo0.tokenAddress,
                genesisQuantity: bn(0),
                rateLimit: fp_10.toString(),
            })

            // Token at 1
            expectTokenInfo(1, {
                tokenAddress: tokenInfo1.tokenAddress,
                genesisQuantity: genesisQty_half.toString(),
                rateLimit: fp_10.toString(),
            })

            // Token at 2
            expectTokenInfo(2, {
                tokenAddress: tokenInfo2.tokenAddress,
                genesisQuantity: genesisQty_third.toString(),
                rateLimit: fp_10.toString(),
            })

            // Token at 3
            expectTokenInfo(3, {
                tokenAddress: tokenInfo3.tokenAddress,
                genesisQuantity: genesisQty_half.toString(),
                rateLimit: fp_10.toString(),
            })
        })

        it("Should return weights correctly", async () => {
            // Token at 0
            const w1 = await caller.weight(BN_SCALE_FACTOR, 0)
            expect(w1).to.equal(genesisQty_half)

            // Token at 1
            const w2 = await caller.weight(BN_SCALE_FACTOR, 1)
            expect(w2).to.equal(genesisQty_third)

            // Reverts for invalid index
            await expect(caller.weight(BN_SCALE_FACTOR, 2)).to.be.revertedWith(
                "InvalidTokenIndex()"
            )
        })

        it("Should calculate weights using inflation", async () => {
            // Set new inflation value to modify weights
            await caller.setInflationSinceGenesis(inflationSinceGenesis_10)
            const newWeight_half = genesisQty_half
                .mul(BN_SCALE_FACTOR)
                .div(inflationSinceGenesis_10)
            const newWeight_third = genesisQty_third
                .mul(BN_SCALE_FACTOR)
                .div(inflationSinceGenesis_10)

            const w1 = await caller.weight(BN_SCALE_FACTOR, 0)
            expect(w1).to.equal(newWeight_half)

            const w2 = await caller.weight(BN_SCALE_FACTOR, 1)
            expect(w2).to.equal(newWeight_third)
        })

        it("Should return amounts for issuance", async () => {
            // With no spread
            const fp_100 = fp(100)
            const fp_50 = fp(50)
            const fp_33 = fp(1).div(3).mul(100)
            let parts = await caller.issueAmounts(fp_100, BN_SCALE_FACTOR, 0, 18)
            expect(parts).to.eql([fp_50, fp_33])

            // Another example with decimals - No spread
            const fp_9 = fp(9)
            const fp_9_3 = fp(1).div(3).mul(9)
            parts = await caller.issueAmounts(fp_9, BN_SCALE_FACTOR, 0, 18)
            expect(parts).to.eql([fp_9.div(2), fp_9_3])
        })

        it("Should return amounts for issuance using spread", async () => {
            // TODO: failing on purpose
            expect(false).to.eql(true)
        })

        it("Should return zero redemption amount if no collateral available", async () => {
            const totalSupply = fp(1000)
            const parts = await caller.redemptionAmounts(fp_10, BN_SCALE_FACTOR, 18, totalSupply)
            expect(parts).to.eql([bn(0), bn(0)])
        })

        it("Should return zero redemption amount if no supply at all", async () => {
            const totalSupply = bn(0)
            const parts = await caller.redemptionAmounts(fp_10, BN_SCALE_FACTOR, 18, totalSupply)
            expect(parts).to.eql([bn(0), bn(0)])
        })

        context("With collateral balance", async () => {
            let totalSupply: BigNumberish
            let fp_500: BigNumberish
            let fp_333: BigNumberish
            let token1: ERC20Mock
            let token2: ERC20Mock

            beforeEach(async function () {
                totalSupply = fp(1000)
                fp_500 = fp(500)
                fp_333 = fp(1).div(3).mul(1000)

                // Add collateral to basket
                token1 = await (<Promise<ERC20Mock>>(
                    ethers.getContractAt("ERC20Mock", tokenInfo0.tokenAddress)
                ))
                await token1.mint(caller.address, fp_500)

                token2 = await (<Promise<ERC20Mock>>(
                    ethers.getContractAt("ERC20Mock", tokenInfo1.tokenAddress)
                ))
                await token2.mint(caller.address, fp_333)
            })

            it("Should return redemption amounts", async () => {
                const fp_100 = fp(100)
                const fp_50 = fp(50)
                const fp_33 = fp(1).div(3).mul(100)
                let parts = await caller.redemptionAmounts(fp_100, BN_SCALE_FACTOR, 18, totalSupply)
                expect(parts).to.eql([fp_50, fp_33])

                // Another example
                const fp_9 = fp(9)
                const fp_9_3 = fp(1).div(3).mul(9)
                parts = await caller.redemptionAmounts(fp_9, BN_SCALE_FACTOR, 18, totalSupply)
                expect(parts).to.eql([fp_9.div(2), fp_9_3])
            })

            it("Should handle amounts with remainder to issue/reedem", async () => {
                const fp_1000 = fp(1000)
                const weight1 = await caller.weight(BN_SCALE_FACTOR, 0) // pick weight for token1 (= others)
                const weight2 = await caller.weight(BN_SCALE_FACTOR, 1) // pick weight for token1 (= others)
                const fp_1000_half = fp_1000.mul(weight1).div(BN_SCALE_FACTOR)
                const fp_1000_third = fp_1000.mul(weight2).div(BN_SCALE_FACTOR)

                // Issue
                let parts = await caller.issueAmounts(fp_1000, BN_SCALE_FACTOR, 0, 18)
                expect(parts).to.eql([fp_1000_half, fp_1000_third])

                // Redeem
                parts = await caller.redemptionAmounts(fp_1000, BN_SCALE_FACTOR, 18, totalSupply)
                expect(parts).to.eql([fp_1000_half, fp_1000_third])

                // Another example
                const fp_1001 = fp(1001)
                const fp_1001_half = fp_1001.mul(weight1).div(BN_SCALE_FACTOR) // same weight as above
                const fp_1001_third = fp_1001.mul(weight2).div(BN_SCALE_FACTOR) // same weight as above

                parts = await caller.issueAmounts(fp_1001, BN_SCALE_FACTOR, 0, 18)
                expect(parts).to.eql([fp_1001_half, fp_1001_third])

                // Redeem
                parts = await caller.redemptionAmounts(fp_1001, BN_SCALE_FACTOR, 18, totalSupply)
                expect(parts).to.eql([fp_1001_half, fp_1001_third])
            })
            it("Should not return collateralized indexes if situation is stable", async () => {
                // If everything is stable, returns -1
                const indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([-1, -1])
            })

            it("Should return least collateralized indexes", async () => {
                // Detects token under collateralized
                const fp_100 = fp(100)
                await token1.burn(caller.address, fp_100)
                let indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([0, -1])

                // Detects token under collateralized (switch)
                await token2.burn(caller.address, fp_100.mul(2))
                indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([1, -1])
            })

            it("Should return most collateralized indexes", async () => {
                // Detects token over collateralized
                const fp_100 = fp(100)
                await token1.mint(caller.address, fp_100)
                let indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([-1, 0])

                // Detects token over collateralized (switch)
                await token2.mint(caller.address, fp_100.mul(2))
                indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([-1, 1])
            })

            it("Should prioritize getting rid of 0 quantity tokens", async () => {
                // Add a third token with extra collateral
                const fp_high = fp(1000000000)
                const tokenInfo2 = await createToken("Token3", "TKN3", genesisQty_third)
                const token3 = await ethers.getContractAt("ERC20Mock", tokenInfo2.tokenAddress)
                await token3.mint(caller.address, fp_high)

                // Remove token at 0 from basket
                tokenInfo0.genesisQuantity = bn(0)

                // Set Tokens
                await caller.setTokens([tokenInfo0, tokenInfo1, tokenInfo2])

                // Token at index 0 should be the prioritized one
                let indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([-1, 0])

                // Assuming collateral was sold for Token 0
                // When calling again moves to the next most collateralized Token at 2
                await token1.burn(caller.address, fp_500)
                indexes = await caller.mostUndercollateralizedAndMostOverCollateralized(
                    BN_SCALE_FACTOR,
                    18,
                    totalSupply
                )
                expect(indexes).to.eql([-1, 2])
            })
        })
    })
})
