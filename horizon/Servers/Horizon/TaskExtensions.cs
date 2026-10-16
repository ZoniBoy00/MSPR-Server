using System;
using System.Threading;
using System.Threading.Tasks;

namespace Horizon
{
    public static class TaskTimeoutExtensions
    {
        /// <summary>
        /// Waits for a task for at most <paramref name="timeout"/> and says whether it finished in time. Closing a channel or
        /// shutting an event loop down can hang for good; a stop that waits for it with no limit then never ends (the idea of
        /// the upstream horizon-server fix for deadlocks in Stop(), written here for this code base).
        /// </summary>
        public static async Task<bool> TryAwait(this Task task, TimeSpan timeout)
        {
            using (var cts = new CancellationTokenSource())
            {
                var done = await Task.WhenAny(task, Task.Delay(timeout, cts.Token));
                if (done == task)
                {
                    cts.Cancel();
                    await task;
                    return true;
                }

                return false;
            }
        }
    }
}
