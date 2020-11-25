// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.6.12;

import '../interfaces/IUniswapV3Pair.sol';

contract UniswapV3PairTest {
    IUniswapV3Pair pair;

    constructor(address pair_) public {
        pair = IUniswapV3Pair(pair_);
    }
}
