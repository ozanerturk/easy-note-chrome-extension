class Configuration {
    constructor(
        {
            step,
            grid,
        } = {
                //default values
                step: 5,
                grid: 10,
            }) {
        this.step = step;
        this.grid = grid;
    }
}