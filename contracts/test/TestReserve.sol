pragma solidity 0.5.7;

import "../rsv/Reserve.sol";
import "../rsv/ReserveEternalStorage.sol";

/**
 * @dev A version of the Reserve Token for testing upgrades.
 */
contract ReserveV2 is Reserve {

    string public constant version = "2.2";

}
