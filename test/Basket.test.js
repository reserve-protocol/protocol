const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BN_SCALE_FACTOR } = require("../common/constants");
const { bn, fp } = require("../common/numbers");

const genesisQty_half = (BN_SCALE_FACTOR.div(2));
const genesisQty_third = (BN_SCALE_FACTOR.div(3));

const inflationSinceGenesis_10 = BN_SCALE_FACTOR.add(BN_SCALE_FACTOR.div(10));

const fp_10 = fp(10);

describe("Basket library", function () {
    // aux function - deploys a token and sets the tokenInfo
    async function createToken(name, symbol, genesisQuantity) {
        const tkn = await ERC20.deploy(name, symbol);
        const tokenInfo = {
            tokenAddress: tkn.address,
            genesisQuantity,
            rateLimit: fp_10,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0
        }

        return tokenInfo;
    }

    beforeEach(async function () {
        [owner, addr1, addr2, other] = await ethers.getSigners();

        // Create Tokens 
        ERC20 = await ethers.getContractFactory("ERC20Mock");

        // Create Token 1
        tokenInfo1 = await createToken("Token1", "TKN1", genesisQty_half);

        // Create Token 2
        tokenInfo2 = await createToken("Token2", "TKN2", genesisQty_half);

        // Setup Basket
        BasketCaller = await ethers.getContractFactory("BasketCallerMock");
        caller = await BasketCaller.deploy([tokenInfo1, tokenInfo2]);
    });


    describe("Tokens", function () {

        async function expectTokenInfo(index, tokenInfo) {
            let result = await caller.getTokenInfo(index);
            expect(result.tokenAddress).to.equal(tokenInfo.tokenAddress);
            expect(result.genesisQuantity).to.equal(tokenInfo.genesisQuantity);
            expect(result.rateLimit).to.equal(tokenInfo.rateLimit);
        }

        it("Should setup initial values correctly", async function () {
            expect(await caller.getBasketSize()).to.equal(2);
            expect(await caller.getInflationSinceGenesis()).to.equal(BN_SCALE_FACTOR);

            // Token at 0
            expectTokenInfo(0, {
                tokenAddress: tokenInfo1.tokenAddress,
                genesisQuantity: genesisQty_half.toString(),
                rateLimit: fp_10.toString()
            })

            // Token at 1
            expectTokenInfo(1, {
                tokenAddress: tokenInfo2.tokenAddress,
                genesisQuantity: genesisQty_half.toString(),
                rateLimit: fp_10.toString()
            })
        });

        it("Should allow to set tokens", async function () {
            // Create Token 3
            tokenInfo3 = await createToken("Token3", "TKN3", genesisQty_third);

            // Create Token 4
            tokenInfo4 = await createToken("Token4", "TKN4", genesisQty_third);

            // Update quantity for Token 2
            tokenInfo2.genesisQuantity = genesisQty_third.toString();

            // Set Tokens
            await caller.setTokens([tokenInfo2, tokenInfo3, tokenInfo4]);

            // Check Basket is properly set
            expect(await caller.getBasketSize()).to.equal(3);
            expect(await caller.getInflationSinceGenesis()).to.equal(BN_SCALE_FACTOR);

            // Token at 0
            expectTokenInfo(0, {
                tokenAddress: tokenInfo2.tokenAddress,
                genesisQuantity: genesisQty_third.toString(),
                rateLimit: fp_10.toString()
            })

            // Token at 1
            expectTokenInfo(1, {
                tokenAddress: tokenInfo3.tokenAddress,
                genesisQuantity: genesisQty_third.toString(),
                rateLimit: fp_10.toString()
            })

            // Token at 2
            expectTokenInfo(2, {
                tokenAddress: tokenInfo4.tokenAddress,
                genesisQuantity: genesisQty_third.toString(),
                rateLimit: fp_10.toString()
            })
        });

        it("Should return weights correctly", async function () {
            // Token at 0
            let w1 = await caller.weight(BN_SCALE_FACTOR, 0);
            expect(w1).to.equal(genesisQty_half);

            // Token at 1
            let w2 = await caller.weight(BN_SCALE_FACTOR, 1)
            expect(w2).to.equal(genesisQty_half);

            // Reverts for invalid index
            await expect(caller.weight(BN_SCALE_FACTOR, 5))
                .to.be.revertedWith("InvalidTokenIndex()");
        });

        it("Should calculate weights using inflation", async function () {
            // Set new inflation value to modify weights
            await caller.setInflationSinceGenesis(inflationSinceGenesis_10);
            const newWeight_half = (genesisQty_half.mul(BN_SCALE_FACTOR)).div(inflationSinceGenesis_10);

            w1 = await caller.weight(BN_SCALE_FACTOR, 0);
            expect(w1).to.equal(newWeight_half);

            w2 = await caller.weight(BN_SCALE_FACTOR, 1)
            expect(w2).to.equal(newWeight_half);
        });

        it("Should return amounts for issuance", async function () {
            // With no spread
            const fp_100 = fp(100);
            const fp_50 = fp(50);
            let parts = await caller.issueAmounts(fp_100, BN_SCALE_FACTOR, 0, 18);
            expect(parts).to.eql([fp_50, fp_50]);

            // Another example with decimals - No spread
            const fp_9 = fp(9);
            parts = await caller.issueAmounts(fp_9, BN_SCALE_FACTOR, 0, 18);
            expect(parts).to.eql([fp_9.div(2), fp_9.div(2)]);
        });

        it("Should return amounts for issuance using spread", async function () {
            // TODO
        });

        it("Should return zero redemption amount if no collateral available", async function () {
            const totalSupply = fp(1000);
            let parts = await caller.redemptionAmounts(fp_10, BN_SCALE_FACTOR, 18, totalSupply);
            expect(parts).to.eql([bn(0), bn(0)]);
        });

        context("With collateral balance", async function () {
            beforeEach(async function () {
                fp_500 = fp(500);

                // Add collateral to basket
                token1 = await ethers.getContractAt("ERC20Mock", tokenInfo1.tokenAddress);
                await token1.mint(caller.address, fp_500);

                token2 = await ethers.getContractAt("ERC20Mock", tokenInfo2.tokenAddress);
                await token2.mint(caller.address, fp_500);

                // set total supply
                totalSupply = fp_500.mul(2);
            });

            it("Should return redemption amounts", async function () {
                const fp_100 = fp(100);
                const fp_50 = fp(50);
                let parts = await caller.redemptionAmounts(fp_100, BN_SCALE_FACTOR, 18, totalSupply);
                expect(parts).to.eql([fp_50, fp_50]);

                // Another example
                const fp_9 = fp(9);
                parts = await caller.redemptionAmounts(fp_9, BN_SCALE_FACTOR, 18, totalSupply);
                expect(parts).to.eql([fp_9.div(2), fp_9.div(2)]);
            });

            it("Should handle amounts with remainder to issue/reedem", async function () {
                // Add a third token
                tokenInfo3 = await createToken("Token3", "TKN3", genesisQty_third);
                token3 = await ethers.getContractAt("ERC20Mock", tokenInfo3.tokenAddress);
                await token3.mint(caller.address, fp_500);
                totalSupply = totalSupply.add(fp_500);

                // Adjust quantities
                tokenInfo1.genesisQuantity = genesisQty_third.toString();
                tokenInfo2.genesisQuantity = genesisQty_third.toString();

                // Set Tokens
                await caller.setTokens([tokenInfo1, tokenInfo2, tokenInfo3]);

                const fp_120 = fp(120);
                const weight = await caller.weight(BN_SCALE_FACTOR, 0); // pick weight for token1 (= others) 
                const fp_120_third = fp_120.mul(weight).div(BN_SCALE_FACTOR);

                // Issue
                let parts = await caller.issueAmounts(fp_120, BN_SCALE_FACTOR, 0, 18);
                expect(parts).to.eql([fp_120_third, fp_120_third, fp_120_third]);

                // Redeem
                parts = await caller.redemptionAmounts(fp_120, BN_SCALE_FACTOR, 18, totalSupply);
                expect(parts).to.eql([fp_120_third, fp_120_third, fp_120_third]);

                // Another example
                const fp_100 = fp(100);
                const fp_100_third = fp_100.mul(weight).div(BN_SCALE_FACTOR); // same weight as above

                parts = await caller.issueAmounts(fp_100, BN_SCALE_FACTOR, 0, 18);
                expect(parts).to.eql([fp_100_third, fp_100_third, fp_100_third]);

                // Redeem
                parts = await caller.redemptionAmounts(fp_100, BN_SCALE_FACTOR, 18, totalSupply);
                expect(parts).to.eql([fp_100_third, fp_100_third, fp_100_third]);
            });
            it("Should not return collateralized indexes if situation is stable", async function () {
                // If everything is stable, returns -1
                let indexes = await caller.leastUndercollateralizedAndMostOverCollateralized(BN_SCALE_FACTOR, 18, totalSupply);
                expect(indexes).to.eql([-1, -1]);
            });

            it("Should return least collateralized indexes", async function () {
                // Detects token under collateralized
                const fp_100 = fp(100);
                await token1.burn(caller.address, fp_100);
                indexes = await caller.leastUndercollateralizedAndMostOverCollateralized(BN_SCALE_FACTOR, 18, totalSupply);
                expect(indexes).to.eql([0, -1]);

                // Detects token under collateralized (switch)
                await token2.burn(caller.address, fp_100.mul(2));
                indexes = await caller.leastUndercollateralizedAndMostOverCollateralized(BN_SCALE_FACTOR, 18, totalSupply);
                expect(indexes).to.eql([1, -1]);
            });

            it("Should return most collateralized indexes", async function () {
                // Detects token over collateralized
                const fp_100 = fp(100);
                await token1.mint(caller.address, fp_100);
                indexes = await caller.leastUndercollateralizedAndMostOverCollateralized(BN_SCALE_FACTOR, 18, totalSupply);
                expect(indexes).to.eql([-1, 0]);

                // Detects token over collateralized (switch)
                await token2.mint(caller.address, fp_100.mul(2));
                indexes = await caller.leastUndercollateralizedAndMostOverCollateralized(BN_SCALE_FACTOR, 18, totalSupply);
                expect(indexes).to.eql([-1, 1]);
            });
        });
    });
});
