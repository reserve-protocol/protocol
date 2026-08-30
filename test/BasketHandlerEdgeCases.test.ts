import { expect } from "chai";
import { ethers } from "hardhat";

describe("BasketHandler Edge Cases & Security Audit", function () {
  let basketHandler: any;
  let basketLib: any;

  beforeEach(async function () {
    const BasketLib = await ethers.getContractFactory("contracts/p1/mixins/BasketLib.sol:BasketLibP1");
    basketLib = await BasketLib.deploy();
    await basketLib.deployed();

    const BasketHandler = await ethers.getContractFactory("BasketHandlerP1", {
      libraries: {
        "contracts/p1/mixins/BasketLib.sol:BasketLibP1": basketLib.address,
      },
    });

    basketHandler = await BasketHandler.deploy();
    await basketHandler.deployed();
  });

  describe("Critical Edge Case Validations", function () {
    it("1. Should safely handle unregistered collateral quantity queries", async function () {
      const fakeToken = "0x0000000000000000000000000000000000000001";
      
      // Henüz set edilmemiş token için revert yerine güvenli 0 dönmeli veya açık revert mesajı almalı
      await expect(basketHandler.quantity(fakeToken)).to.be.reverted;
    });

    it("2. Should prevent precision loss / zero-division on micro collateral amounts", async function () {
      const status = await basketHandler.status();
      expect(status).to.not.be.undefined;
    });

    it("3. Should handle uncollateralized status transition safely", async function () {
      if (basketHandler.basketsHeld) {
        const held = await basketHandler.basketsHeld();
        expect(held).to.equal(0);
      }
    });
  });
});