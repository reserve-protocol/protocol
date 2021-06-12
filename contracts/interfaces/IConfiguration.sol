pragma solidity 0.8.4;

interface IConfiguration is Ownable {

    function upgradeBasket(Settings.CollateralToken[] calldata _basket) external onlyOwner {
        basket = _basket;
    }

    function upgradeParameters(Settings.Parameters calldata _parameters) external onlyOwner {
        parameters = _parameters;
    }
}
