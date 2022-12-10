// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurvePool_3.sol";

interface ICurveCryptoPool3Assets is ICurvePool3Assets {
    function A() external view returns (uint256);

    function gamma() external view returns (uint256);

    function price_oracle(uint256 i) external view returns (uint256);

    function price_scale(uint256 i) external view returns (uint256);

    function last_prices(uint256 i) external view returns (uint256);
}
