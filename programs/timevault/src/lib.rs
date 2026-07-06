use anchor_lang::prelude::*;

declare_id!("Vau1tNwoYo91MsHHCMwn5Y1WzStFRzRxegH7CAX1vni");

pub mod error;
pub mod instructions;
pub mod pubkeys;
pub mod state;

use instructions::*;

#[program]
pub mod timevault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, timeout: i64) -> Result<()> {
        instructions::initialize::initialize(ctx, timeout)
    }

    pub fn checkin(ctx: Context<Checkin>) -> Result<()> {
        instructions::checkin::checkin(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::claim(ctx)
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        instructions::cancel::cancel(ctx)
    }
}
