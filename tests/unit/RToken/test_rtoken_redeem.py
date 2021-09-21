

describe("Redeem", function () {
        it("Should revert if there is no supply of RToken", async function () {
            const redeemAmount = BigNumber.from(1000)

            await expect(rToken.connect(addr1).redeem(redeemAmount)).to.be.revertedWith(
                "ERC20: burn amount exceeds balance"
            )
        })

        context("With issued RTokens", async function () {
            let mintAmount: BigNumber

            beforeEach(async function () {
                // Issue some RTokens to user
                mintAmount = bn(5000)
                await bskToken.mint(addr1.address, mintAmount)
                await bskToken.connect(addr1).approve(rToken.address, mintAmount)

                await expect(rToken.connect(addr1).issue(mintAmount))
                    .to.emit(rToken, "SlowMintingInitiated")
                    .withArgs(addr1.address, mintAmount)

                // Process Minting
                await rToken.tryProcessMintings()
                expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
                expect(await rToken.totalSupply()).to.equal(mintAmount)
            })

            it("Should not redeem RTokens if amount is 0", async function () {
                const redeemAmount = bn(0)

                await expect(rToken.redeem(redeemAmount)).to.be.revertedWith(
                    "RedeemAmountCannotBeZero()"
                )
            })

            it("Should not redeem RTokens if basket is empty", async function () {
                const redeemAmount = bn(100)
                const newTokens: IBasketToken[] = []

                // Update to empty basket
                await expect(rToken.connect(owner).updateBasket(newTokens))
                    .to.emit(rToken, "BasketUpdated")
                    .withArgs(basketTokens.length, newTokens.length)

                await expect(rToken.redeem(redeemAmount)).to.be.revertedWith("EmptyBasket()")
            })

            it("Should revert if users does not have enough RTokens", async function () {
                const redeemAmount = bn(10000)

                await expect(rToken.connect(addr1).issue(redeemAmount)).to.be.revertedWith(
                    "ERC20: transfer amount exceeds balance"
                )
            })

            it("Should redeem RTokens correctly", async function () {
                const redeemAmount = bn(500)

                // Check balances
                expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
                expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount)
                expect(await bskToken.balanceOf(addr1.address)).to.equal(bn(0))

                // Redeem rTokens
                await expect(rToken.connect(addr1).redeem(redeemAmount))
                    .to.emit(rToken, "Redemption")
                    .withArgs(addr1.address, redeemAmount)

                // Check funds were transferred
                expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount.sub(redeemAmount))
                expect(await rToken.totalSupply()).to.equal(mintAmount.sub(redeemAmount))
                expect(await bskToken.balanceOf(rToken.address)).to.equal(
                    mintAmount.sub(redeemAmount)
                )
                expect(await bskToken.balanceOf(addr1.address)).to.equal(redeemAmount)
            })
        })