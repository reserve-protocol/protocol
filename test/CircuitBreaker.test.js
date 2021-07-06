const { expect } = require("chai");

describe("CircuitBreaker contract", function () {

  let CircuitBreaker;
  let cbContract;
  let addr1;
  let addrs;

  const PAUSER_ROLE = ethers.utils.solidityKeccak256(["string"], ["PAUSER_ROLE"]);

  beforeEach(async function () {
    CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
    [owner, addr1, ...addrs] = await ethers.getSigners();
    cb = await CircuitBreaker.deploy(owner.address);
  });

  describe("Deployment", function () {
    it("Should create contract with status and Pauser", async function () {
      expect(await cb.check()).to.equal(false);
      expect(await cb.hasRole(PAUSER_ROLE, owner.address)).to.equal(true);
    });
  });

  describe("Pause/Unpause", function () {
    it("Should pause/unpause for Pauser role", async function () {
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

    it("Should not allow to pause/unpause if not Pauser", async function () {
      await expect(cb.connect(addr1).pause()).to.be.reverted;
      await expect(cb.connect(addr1).unpause()).to.be.reverted;
    });
  });

});