using System.Threading;

namespace MultiServerLibrary
{
    /// <summary>
    /// Lock around one-time initialisation. The named (machine-wide) mutex keeps two Horizon processes from initialising
    /// at once; on Linux with .NET 9+ creating it can fail (the shared-memory file is not reachable in a hardened service),
    /// and then the initialisation would be skipped altogether. Fall back to a process-local mutex in that case.
    /// </summary>
    public static class InitLock
    {
        public static Mutex Create(string name)
        {
            try
            {
                return new Mutex(false, $"Global\\{name}Lock");
            }
            catch (System.IO.IOException)
            {
                return new Mutex(false);
            }
            catch (System.UnauthorizedAccessException)
            {
                return new Mutex(false);
            }
        }
    }
}
