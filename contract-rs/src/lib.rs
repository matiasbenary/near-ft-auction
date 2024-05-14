// Find all our documentation at https://docs.near.org
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Gas, PanicOnDefault, Promise};

pub mod ext;
pub use crate::ext::*;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Bid {
    pub bidder: AccountId,
    pub bid: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    highest_bid: Bid,
    auction_end_time: U64,
    auctioneer: AccountId,
    auction_was_claimed: bool,
    ft_contract: AccountId,
}

#[near]
impl Contract {
    #[init]
    #[private] // only callable by the contract's account
    pub fn init(end_time: U64, auctioneer: AccountId, ft_contract: AccountId) -> Self {
        Self {
            highest_bid: Bid {
                bidder: env::current_account_id(),
                bid: U128(0),
            },
            auction_end_time: end_time,
            auctioneer: auctioneer,
            auction_was_claimed: false,
            ft_contract: ft_contract,
        }
    }

    pub fn get_highest_bid(&self) -> Bid {
        self.highest_bid.clone()
    }

    pub fn get_auction_end_time(&self) -> U64 {
        self.auction_end_time
    }

    // pub fn auction_end(&mut self) -> Promise {
    //     assert!(env::predecessor_account_id() == self.auctioneer, "You must place a higher bid");
    //     assert!(env::block_timestamp() < self.auction_end_time.into(), "Auction has not ended yet");
    //     assert!(!self.auction_was_claimed, "Auction has been claimed");
    //     self.auction_was_claimed = true;
    //     let auctioneer = self.auctioneer.clone();
    //     Promise::new(auctioneer).transfer(self.highest_bid.bid)
    // }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> Promise {
        assert!(
            env::block_timestamp() < self.auction_end_time.into(),
            "Auction has ended"
        );

        let ft = env::predecessor_account_id();
        require!(ft == self.ft_contract, "The token is not supported");

        let Bid {
            bidder: last_bidder,
            bid: last_bid,
        } = self.highest_bid.clone();

        require!(amount >= last_bid, "You must place a higher bid");

        self.highest_bid = Bid {
            bidder: sender_id,
            bid: amount,
        };

        ft_contract::ext(self.ft_contract.clone())
            .with_static_gas(Gas::from_tgas(30))
            .ft_transfer(last_bidder, last_bid)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .ft_transfer_callback(),
            )
    }

    #[private]
    pub fn ft_transfer_callback(&mut self) -> U128 {
        U128::from(123)
    }
}

/*
 * The rest of this file holds the inline tests for the code above
 * Learn more about Rust tests: https://doc.rust-lang.org/book/ch11-01-writing-tests.html
 */
// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[test]
//     fn init_contract() {
//         let auctioneer: AccountId = "auctioneer.testnet".parse().unwrap();
//         let contract = Contract::init(U64::from(1000), auctioneer);

//         let default_bid = contract.get_highest_bid();
//         assert_eq!(default_bid.bidder, env::current_account_id());
//         assert_eq!(default_bid.bid, NearToken::from_yoctonear(1));

//         let end_time = contract.get_auction_end_time();
//         assert_eq!(end_time, U64::from(1000));
//     }
// }
