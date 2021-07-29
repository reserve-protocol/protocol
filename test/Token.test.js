const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { SCALE_FACTOR } = require("./utils/constants");

describe("Token library", function () {
    beforeEach(async function () {
        [owner, addr1, addr2, other] = await ethers.getSigners();

        ERC20 = await ethers.getContractFactory("ERC20Mock");
        token = await ERC20.deploy("Token", "TKN");

        // Set token info
        innerTokenInfo = {
            tokenAddress: token.address,
            genesisQuantity: 0,
            rateLimit: 1,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0
        };

        // ERC20 Token
        TokenCaller = await ethers.getContractFactory("TokenCallerMock");
        caller = await TokenCaller.deploy(innerTokenInfo);

        // Mint some tokens to the caller contract
        amount = BigNumber.from(5000);
        await token.mint(caller.address, amount);
    })

    describe("Balance", function () {
        it("Should return balances correctly", async function () {
            expect(await caller["getBalance(address)"](addr1.address)).to.equal(0);
            expect(await caller["getBalance(address)"](addr2.address)).to.equal(0);
            expect(await caller["getBalance(address)"](caller.address)).to.equal(amount);
            expect(await caller["myBalance()"]()).to.equal(amount);
        });
    });

    describe("Transfers", function () {
        it("Should transfer tokens correctly", async function () {
            // Transfer
            await caller.safeTransfer(addr1.address, amount);
            expect(await caller["getBalance(address)"](addr1.address)).to.equal(amount);
            expect(await caller["getBalance(address)"](caller.address)).to.equal(0);

            // Check underlying token contract
            expect(await token.balanceOf(addr1.address)).to.equal(amount);
            expect(await token.balanceOf(caller.address)).to.equal(0);
        });


        it("Should approve tokens correctly", async function () {
            // Approval
            await caller.safeApprove(other.address, amount);

            // Other address can do transfer
            await token.connect(other).transferFrom(caller.address, addr1.address, amount);

            expect(await caller["getBalance(address)"](addr1.address)).to.equal(amount);
            expect(await caller["getBalance(address)"](caller.address)).to.equal(0);

            // Check underlying token contract
            expect(await token.balanceOf(addr1.address)).to.equal(amount);
            expect(await token.balanceOf(caller.address)).to.equal(0);

        });

        it("Should transferFrom tokens correctly", async function () {
            const amount2 = BigNumber.from(2000);
            await token.mint(addr1.address, amount2);

            // Approval for caller contract
            await token.connect(addr1).approve(caller.address, amount2);

            // Transfer
            await caller.safeTransferFrom(addr1.address, addr2.address, amount2);
            expect(await caller["getBalance(address)"](addr1.address)).to.equal(0);
            expect(await caller["getBalance(address)"](addr2.address)).to.equal(amount2);
            expect(await caller["getBalance(address)"](caller.address)).to.equal(amount);

            // Check underlying token contract
            expect(await token.balanceOf(addr1.address)).to.equal(0);
            expect(await token.balanceOf(addr2.address)).to.equal(amount2);
            expect(await token.balanceOf(caller.address)).to.equal(amount);

        });
    });

    // TODO: Need to complete tests for Adjust quantities
    // describe("Adjust Quantities", function () {
    //     it("Should update quantities correctly", async function () {
    //         const scale = BigNumber.from(SCALE_FACTOR.toString());
    //         const expansionPerSecond =  ....;
    //         const deployedAt = await caller.deployedAt();
    //         const adjustedAmt = ....;
    //         await caller.adjustQuantity(scale, expansionPerSecond, deployedAt);
    //         //expect(await caller.getAdjustedQuantity()).to.equal(adjustedAmt); 
    //     });
    // });
});
