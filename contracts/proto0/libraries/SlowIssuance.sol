// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IVault.sol";

library SlowIssuance {
    using SafeERC20 for IERC20;

    struct Info {
        IVault vault;
        uint256 amount;
        uint256 BUs;
        uint256[] basketAmounts;
        address minter;
        uint256 blockAvailableAt;
        bool processed;
    }

    function start(
        SlowIssuance.Info storage self,
        IVault vault,
        uint256 amount,
        uint256 BUs,
        address minter,
        uint256 blockAvailableAt
    ) internal {
        self.vault = vault;
        self.amount = amount;
        self.BUs = BUs;
        self.basketAmounts = vault.tokenAmounts(BUs);
        self.minter = minter;
        self.blockAvailableAt = blockAvailableAt;

        for (uint256 i = 0; i < vault.size(); i++) {
            IERC20(vault.assetAt(i).erc20()).safeTransferFrom(minter, address(this), self.basketAmounts[i]);
            IERC20(self.vault.assetAt(i).erc20()).safeApprove(address(self.vault), self.basketAmounts[i]);
        }
        self.vault.issue(self.BUs);
    }

    function process(
        SlowIssuance.Info storage self,
        IRToken rToken,
        IVault vault
    ) internal {
        require(!self.processed, "slow minting already processed");
        require(self.blockAvailableAt <= block.number, "slow minting needs more time");

        if (address(self.vault) != address(vault)) {
            // Revert Issuance
            rToken.burn(address(this), self.amount);
            self.vault.redeem(self.minter, self.BUs);
        } else {
            // Complete Issuance
            rToken.transfer(self.minter, self.amount);
        }
        self.processed = true;
    }
}
