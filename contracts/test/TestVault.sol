pragma solidity ^0.5.7;

import "../Basket.sol";
import "../Manager.sol";
import "../Vault.sol";
import "../rsv/IRSV.sol";

contract VaultV2 is Vault {

    function completeHandoff(address previousVaultAddress, address managerAddress) external onlyOwner {
        Vault previousVault = Vault(previousVaultAddress);
        Manager manager = Manager(managerAddress);

        previousVault.acceptOwnership();

        previousVault.changeManager(address(this));

        // Transfer tokens from old vault to new vault.
        Basket trustedBasket = manager.trustedBasket();

        for (uint256 i = 0; i < trustedBasket.size(); i++) {
            address tokenAddr = trustedBasket.tokens(i);
            IERC20 token = IERC20(tokenAddr);

            previousVault.withdrawTo(
                tokenAddr,
                token.balanceOf(address(previousVaultAddress)),
                address(this)
            );
        }

        // Point manager at the new vault.
        manager.acceptOwnership();
        manager.setVault(address(this));
        manager.nominateNewOwner(_msgSender());
        previousVault.nominateNewOwner(_msgSender());
    }
}
