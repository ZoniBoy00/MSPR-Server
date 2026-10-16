using DotNetty.Transport.Channels;

namespace Horizon
{
    /// <summary>
    /// DotNetty worker pools. The default size is 2 x CPU cores per pool and Horizon creates several pools
    /// per server and per DME application, which ended at ~1800 threads. MotorStorm: Pacific Rift needs a
    /// handful: HORIZON_IO_THREADS (default 4) threads per pool.
    /// </summary>
    public static class EventLoops
    {
        public static readonly int WorkerThreads =
            int.TryParse(System.Environment.GetEnvironmentVariable("HORIZON_IO_THREADS"), out int n) && n > 0 ? n : 4;

        public static MultithreadEventLoopGroup Workers() => new MultithreadEventLoopGroup(WorkerThreads);
    }
}
