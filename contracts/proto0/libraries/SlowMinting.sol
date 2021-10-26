// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IVault.sol";

library SlowMinting {
    using SafeERC20 for IERC20;

    struct Info {
        IVault vault;
        uint256 amount;
        uint256 BUs;
        uint256[] basketAmounts;
        address minter;
        uint256 availableAt;
        bool processed;
    }

    function start(
        SlowMinting.Info storage self,
        IVault vault,
        uint256 amount,
        uint256 BUs,
        address minter,
        uint256 availableAt
    ) internal {
        self.vault = vault;
        self.amount = amount;
        self.BUs = BUs;
        self.basketAmounts = vault.tokenAmounts(BUs);
        self.minter = minter;
        self.availableAt = availableAt;

        for (uint256 i = 0; i < vault.basketSize(); i++) {
            IERC20(vault.collateralAt(i).erc20()).safeTransferFrom(minter, address(this), self.basketAmounts[i]);
            IERC20(self.vault.collateralAt(i).erc20()).safeApprove(address(self.vault), self.basketAmounts[i]);
        }
        self.vault.issue(self.BUs);
    }

    function complete(SlowMinting.Info storage self) internal {
        require(!self.processed, "slow minting already processed");
        require(self.availableAt < block.timestamp, "slow minting needs more time");

        self.processed = true;
    }

    function undo(SlowMinting.Info storage self) internal {
        require(!self.processed, "slow minting already processed");

        self.vault.redeem(self.minter, self.BUs);
        self.processed = true;
    }
}
