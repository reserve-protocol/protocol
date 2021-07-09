const { expect } = require("chai");
const { BigNumber } = require("ethers");

describe("RSR contract", function () {
    beforeEach(async function () {
        [owner, addr1, addr2, slowWallet, multisigWallet] = await ethers.getSigners();

        // Deploy Previous RSR Mock (Pausable)
        PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock");
        prevToken = await PrevRSR.deploy("Reserve Rights", "RSR");
        await prevToken.mint(owner.address, BigNumber.from(1000));
        await prevToken.mint(addr1.address, BigNumber.from(2000));
        await prevToken.mint(addr2.address, BigNumber.from(3000));
        await prevToken.mint(slowWallet.address, BigNumber.from(3000));
        await prevToken.mint(multisigWallet.address, BigNumber.from(10000));

        await prevToken.connect(owner).approve(addr1.address, BigNumber.from(500));
        await prevToken.connect(addr2).approve(addr1.address, BigNumber.from(200));

        // Deploy new RSR
        RSR = await ethers.getContractFactory("RSR");
        token = await RSR.connect(owner).deploy(prevToken.address, slowWallet.address, multisigWallet.address, "Reserve Rights", "RSR");
    });

    describe("Deployment", function () {
        it("Should start with the total supply of previous RSR", async function () {
            const totalSupplyPrev = await prevToken.totalSupply();
            expect(await token.totalSupply()).to.equal(totalSupplyPrev);
        });

        it("Should setup correctly initial values", async function () {
            const totalSupply = await token.totalSupply();
            expect(await token.tokensToCross()).to.equal(totalSupply);
            expect(await token.fixedSupply()).to.equal(totalSupply);
            expect(await token.snapshotter()).to.equal(owner.address);
            expect(await token.slowWallet()).to.equal(slowWallet.address);
            expect(await token.multisigWallet()).to.equal(multisigWallet.address);
        });
    });

    describe("Balances and Transfers - Before Pausing Previous RSR", function () {
        it("Should return balances from previous RSR if not crossed", async function () {
            // Compare balances between contracts
            expect(await token.balanceOf(owner.address)).to.equal(await prevToken.balanceOf(owner.address));
            expect(await token.balanceOf(addr1.address)).to.equal(await prevToken.balanceOf(addr1.address));
            expect(await token.balanceOf(addr2.address)).to.equal(await prevToken.balanceOf(addr2.address));

            // Ensure no tokens where crossed
            expect(await token.crossed(owner.address)).to.equal(false);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.crossed(addr2.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(await prevToken.totalSupply());
        });

        it("Should not populate allowances from previous RSR", async function () {
            expect(await token.allowance(owner.address, addr1.address)).to.equal(0);
            expect(await token.allowance(addr2.address, addr1.address)).to.equal(0);

            // No tokens where crossed
            expect(await token.crossed(owner.address)).to.equal(false);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.crossed(addr2.address)).to.equal(false);
        });

        it("Should not transfer tokens between accounts if Previous RSR is not paused", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(50);
            const addr1BalancePrev = await token.balanceOf(addr1.address);

            await expect(
                token.connect(owner).transfer(addr1.address, amount)
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

            const addr1Balance = await token.balanceOf(addr1.address);
            expect(addr1Balance).to.equal(addr1BalancePrev);

            // No tokens crossed
            expect(await token.crossed(owner.address)).to.equal(false);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(await prevToken.totalSupply());
        });

        it("Should not transferFrom tokens between accounts if Previous RSR is not paused", async function () {
            // Transfer 500 tokens from owner to addr2, handled by addr1 (allowance)
            const amount = BigNumber.from(500);
            const addr2BalancePrev = await token.balanceOf(addr2.address);

            await expect(
                token.connect(addr1).transferFrom(owner.address, addr2.address, amount)
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

            const addr2Balance = await token.balanceOf(addr2.address);
            expect(addr2Balance).to.equal(addr2BalancePrev);

            // No tokens crossed
            expect(await token.crossed(owner.address)).to.equal(false);
            expect(await token.crossed(addr2.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(await prevToken.totalSupply());
        });

        it("Should allow to grant allowances between accounts even if Previous RSR is not paused", async function () {
            const amount = BigNumber.from(100);

            // Grant allowance
            await token.connect(owner).approve(addr1.address, amount);

            const addr1Allowance = await token.allowance(owner.address, addr1.address)
            expect(addr1Allowance).to.equal(amount);

            // No tokens crossed
            expect(await token.crossed(owner.address)).to.equal(false);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(await prevToken.totalSupply());
        });
    });

    describe("Balances and Transfers - After Pausing Previous RSR", function () {
        beforeEach(async function () {
            // Pause previous contract
            await prevToken.connect(owner).pause();
            totalSupply = await token.totalSupply();
        });

        it("Should transfer tokens between accounts and cross sender", async function () {
            // Transfer 50 tokens from owner to addr1 
            const amount = BigNumber.from(50);
            const ownerBalancePrev = await token.balanceOf(owner.address);
            const addr1BalancePrev = await token.balanceOf(addr1.address);

            // Perform transfer
            await token.connect(owner).transfer(addr1.address, amount);

            expect(await token.balanceOf(addr1.address)).to.equal(addr1BalancePrev.add(amount));
            expect(await token.balanceOf(owner.address)).to.equal(ownerBalancePrev.sub(amount));

            // Check owner has crossed
            expect(await token.crossed(owner.address)).to.equal(true);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(totalSupply - ownerBalancePrev);
        });

        it("Should transferFrom tokens between accounts and cross sender", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(500);
            const ownerBalancePrev = await token.balanceOf(owner.address);
            const addr2BalancePrev = await token.balanceOf(addr2.address);

            // Set allowance and transfer
            await token.connect(owner).approve(addr1.address, amount);
            await token.connect(addr1).transferFrom(owner.address, addr2.address, amount);

            expect(await token.balanceOf(addr2.address)).to.equal(addr2BalancePrev.add(amount));
            expect(await token.balanceOf(owner.address)).to.equal(ownerBalancePrev.sub(amount));

            // Check owner has crossed
            expect(await token.crossed(owner.address)).to.equal(true);
            expect(await token.crossed(addr2.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(totalSupply.sub(ownerBalancePrev));
        });

        it("Should cross only once with consecutive transfers", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount1 = BigNumber.from(50);
            const amount2 = BigNumber.from(100);
            const ownerBalancePrev = await token.balanceOf(owner.address);
            const addr1BalancePrev = await token.balanceOf(addr1.address);

            // Perform transfer
            await token.connect(owner).transfer(addr1.address, amount1);

            expect(await token.balanceOf(addr1.address)).to.equal(addr1BalancePrev.add(amount1));
            expect(await token.balanceOf(owner.address)).to.equal(ownerBalancePrev.sub(amount1));

            // Check owner has crossed
            expect(await token.crossed(owner.address)).to.equal(true);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(totalSupply.sub(ownerBalancePrev));

            // Perform second transfer of 50 tokens from owner to addr1
            await token.connect(owner).transfer(addr1.address, amount2);

            expect(await token.balanceOf(addr1.address)).to.equal(addr1BalancePrev.add(amount1).add(amount2));
            expect(await token.balanceOf(owner.address)).to.equal(ownerBalancePrev.sub(amount1).sub(amount2));

            // Check owner has crossed
            expect(await token.crossed(owner.address)).to.equal(true);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(totalSupply.sub(ownerBalancePrev));
        });

        it("Should add slowWallet balance when crossing multisig", async function () {
            // Transfer tokens from multisig to addr1 
            const amount = BigNumber.from(200);
            const multisigBalancePrev = await token.balanceOf(multisigWallet.address);
            const slowWalletBalancePrev = await token.balanceOf(slowWallet.address);
            const addr1BalancePrev = await token.balanceOf(addr1.address);

            // Perform transfer from multisig
            await token.connect(multisigWallet).transfer(addr1.address, amount);

            expect(await token.balanceOf(addr1.address)).to.equal(addr1BalancePrev.add(amount));
            expect(await token.balanceOf(multisigWallet.address)).to.equal(multisigBalancePrev.add(slowWalletBalancePrev).sub(amount));
            expect(await token.balanceOf(slowWallet.address)).to.equal(0);

            // Check multisig and slowWallet have crossed
            expect(await token.crossed(multisigWallet.address)).to.equal(true);
            expect(await token.crossed(slowWallet.address)).to.equal(true);
            expect(await token.crossed(addr1.address)).to.equal(false);
            expect(await token.tokensToCross()).to.equal(totalSupply.sub(multisigBalancePrev).sub(slowWalletBalancePrev));
        });
    });

    describe("Snapshots", function () {
        it("Should allow snapshotter to set a new snapshotter", async function () {
            expect(await token.snapshotter()).to.equal(owner.address);

            await expect(token.transferSnapshotter(addr1.address))
                .to.emit(token, 'SnapshotterChanged')
                .withArgs(owner.address, addr1.address);

            expect(await token.snapshotter()).to.equal(addr1.address);
        });

        it("Should not allow to set snapshotter if not current snapshotter", async function () {
            expect(await token.snapshotter()).to.equal(owner.address);

            await expect(
                token.connect(addr1).transferSnapshotter(addr1.address)
            ).to.be.revertedWith("RSR: Only snapshotter can snapshot");

            expect(await token.snapshotter()).to.equal(owner.address);
        });

        it("Should snapshot totalSupply", async function () {
            await expect(
                token.connect(owner).snapshot()
            ).to.emit(token, "Snapshot").withArgs(1);

            expect(await token.totalSupply()).to.equal(await token.totalSupplyAt(1));

            await expect(
                token.connect(owner).snapshot()
            ).to.emit(token, "Snapshot").withArgs(2);

            expect(await token.totalSupply()).to.equal(await token.totalSupplyAt(2));
        });

        it("Should snapshot balances", async function () {
            const amount = BigNumber.from(50);
            const ownerBalancePrev = await token.balanceOf(owner.address);
            const addr1BalancePrev = await token.balanceOf(addr1.address);

            // Pause old contract to cross tokens and impact supply
            await prevToken.connect(owner).pause();

            await expect(
                token.connect(owner).snapshot()
            ).to.emit(token, "Snapshot").withArgs(1);

            expect(await token.balanceOf(owner.address)).to.equal(await token.balanceOfAt(owner.address, 1));
            expect(await token.balanceOf(addr1.address)).to.equal(await token.balanceOfAt(addr1.address, 1));
            expect(await token.balanceOf(addr2.address)).to.equal(await token.balanceOfAt(addr2.address, 1));
            expect(await token.balanceOfAt(owner.address, 1)).to.equal(ownerBalancePrev);
            expect(await token.balanceOfAt(addr1.address, 1)).to.equal(addr1BalancePrev);
            
            // Perform a transfer to impact balances    
            await token.connect(owner).transfer(addr1.address, amount);

            await expect(
                token.connect(owner).snapshot()
            ).to.emit(token, "Snapshot").withArgs(2);

            expect(await token.balanceOf(owner.address)).to.equal(await token.balanceOfAt(owner.address, 2));
            expect(await token.balanceOf(addr1.address)).to.equal(await token.balanceOfAt(addr1.address, 2));
            expect(await token.balanceOf(addr2.address)).to.equal(await token.balanceOfAt(addr2.address, 2));
            expect(await token.balanceOfAt(owner.address, 2)).to.equal(ownerBalancePrev.sub(amount));
            expect(await token.balanceOfAt(addr1.address, 2)).to.equal(addr1BalancePrev.add(amount));
          
            // Snapshots contain different values for the same accounts
            expect(await token.balanceOfAt(owner.address, 1)).to.not.equal(await token.balanceOfAt(owner.address, 2));
            expect(await token.balanceOfAt(addr1.address, 1)).to.not.equal(await token.balanceOfAt(addr1.address, 2));
        });
    });
});
