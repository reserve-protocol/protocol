const { expect } = require("chai");

const PAUSER_ROLE = ethers.utils.solidityKeccak256(["string"], ["PAUSER_ROLE"]);

describe("CircuitBreaker contract", function () {
  beforeEach(async function () {
    CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
    [owner, addr1] = await ethers.getSigners();
    cb = await CircuitBreaker.deploy(owner.address);
  });

  describe("Deployment", function () {
    it("Should create contract with Status and Pauser", async function () {
      expect(await cb.check()).to.equal(false);
      expect(await cb.hasRole(PAUSER_ROLE, owner.address)).to.equal(true);
    });
  });

  describe("Pause/Unpause", function () {
    it("Should Pause/Unpause for Pauser role", async function () {
      // Pause
      await expect(cb.connect(owner).pause())
        .to.emit(cb, 'Paused')
        .withArgs(owner.address);

      expect(await cb.check()).to.equal(true);

      // Unpause
      await expect(cb.connect(owner).unpause())
        .to.emit(cb, 'Unpaused')
        .withArgs(owner.address);

      expect(await cb.check()).to.equal(false);
    });

    it("Should not allow to Pause/Unpause if not Pauser", async function () {
      await expect(
        cb.connect(addr1).pause()
      ).to.be.revertedWith("CircuitBreaker: Must be pauser role");

      await expect(
        cb.connect(addr1).unpause()
      ).to.be.revertedWith("CircuitBreaker: Must be pauser role");
    });
  });
});