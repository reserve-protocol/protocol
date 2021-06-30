// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./zeppelin/token/ERC20/ERC20.sol";
import "./zeppelin/token/ERC20/IERC20.sol";
import "./interfaces/IConfiguration.sol";
import "./interfaces/ICircuitBreaker.sol";
import "./interfaces/ISlowMintingERC20.sol";
import "./RelayERC20.sol";

/*
 * @title SlowMintingERC20 
 * @dev An ERC20 that time-delays minting events, causing the internal balance mapping 
 * of the contract to update only after an appropriate delay. 
 * 
 * The delay is determined using a FIFO minting queue. The queue stores the block of the initial 
 * minting event. As the block number increases, mintings are taken off the queue and paid out. 
 *
 * *Contract Invariant*
 * At any reasonable setting of values this algorithm should not result in the queue growing 
 * unboundedly. In the worst case this does occur, portions of the queue can be processed 
 * manually by calling `tryProcessMintings` directly. 
 */ 
abstract contract SlowMintingERC20 is ISlowMintingERC20, RelayERC20 {

    IConfiguration public override conf;

    struct Minting {
        uint256 amount;
        address account;
    }

    Minting[] private mintings;
    uint256 private currentMinting;
    uint256 private lastBlockChecked;

    constructor(
        string memory name_, 
        string memory symbol_, 
        address conf_
    ) ERC20(name_, symbol_) {
        conf = IConfiguration(conf_);
        lastBlockChecked = block.number;
    }


    modifier update() {
        tryProcessMintings();
        _;
    }

    function tryProcessMintings() public {
        tryProcessMintings(mintings.length - currentMinting);
    }

    /// Tries to process `count` mintings. Called before most actions.
    /// Can also be called directly if we get to the block gas limit. 
    function tryProcessMintings(uint256 count) public {
        if (!ICircuitBreaker(conf.circuitBreaker()).check()) {
            uint256 start = currentMinting;
            uint256 blocksSince = block.number - lastBlockChecked;
            while (currentMinting < mintings.length && currentMinting < start + count) {
                Minting storage m = mintings[currentMinting];

                // Break if the next minting is too big.
                if (m.amount > conf.issuanceRate() * (blocksSince)) {
                    break;
                }
                _mint(m.account, m.amount);
                emit MintingComplete(m.account, m.amount);

                uint256 blocksUsed = m.amount / conf.issuanceRate();
                if (blocksUsed * conf.issuanceRate() > m.amount) {
                    blocksUsed = blocksUsed + 1;
                }
                blocksSince = blocksSince - blocksUsed;
                delete mintings[currentMinting]; // gas saving..?
                currentMinting++;
            }
        }
        lastBlockChecked = block.number;
    }


    /// ==== Super functions /w update ====

    function transfer(address recipient, uint256 amount) public override(IERC20) virtual update returns (bool) {
        return super.transfer(recipient, amount);
    }

    function relayedTransfer(
        bytes calldata sig,
        address from,
        address to,
        uint256 amount,
        uint256 fee
    ) public override(IRelayERC20, RelayERC20) update {
        super.relayedTransfer(sig, from, to, amount, fee);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override(IERC20) virtual update returns (bool) {
        return super.transferFrom(sender, recipient, amount);
    }

    /// ==== Callable only by self ====
    function startMinting(address account, uint256 amount) public override {
        require(_msgSender() == address(this), "ERC20: mint is only callable by self");
        require(account != address(0), "ERC20: mint to the zero address");
        require(amount > 0, "cannot mint 0");

        Minting memory m = Minting(amount, account);
        mintings.push(m);
        emit MintingInitiated(account, amount);
    }
}
