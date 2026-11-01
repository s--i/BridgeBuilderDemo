// Export analysis artifacts without executing the original program.
// @category BridgeBuilder
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class ExportBridgeAnalysis extends GhidraScript {
    private PrintWriter output(File dir, String name) throws Exception {
        return new PrintWriter(new File(dir, name), StandardCharsets.UTF_8);
    }
    public void run() throws Exception {
        File dir = new File(getScriptArgs()[0]);
        dir.mkdirs();
        DecompInterface decompiler = new DecompInterface();
        if (!decompiler.openProgram(currentProgram)) {
            throw new IOException(decompiler.getLastMessage());
        }
        int count = 0, success = 0;
        try (PrintWriter functions = output(dir, "functions.tsv");
             PrintWriter source = output(dir, "bridge-decompiled.c");
             PrintWriter strings = output(dir, "strings-and-references.tsv");
             PrintWriter summary = output(dir, "summary.txt")) {
            source.println("/* Automated Ghidra output, not original source. Types, signatures and function boundaries need review. */");
            functions.println("address\tname\tbytes\tconvention\tdecompiled");
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && !monitor.isCancelled()) {
                Function function = iterator.next();
                count++;
                DecompileResults result = decompiler.decompileFunction(function, 15, monitor);
                boolean ok = result.decompileCompleted() && result.getDecompiledFunction() != null;
                functions.printf("%s\t%s\t%d\t%s\t%s%n", function.getEntryPoint(), function.getName(),
                    function.getBody().getNumAddresses(), function.getCallingConventionName(), ok);
                source.printf("%n/* %s %s */%n", function.getEntryPoint(), function.getName());
                if (ok) {
                    success++;
                    source.println(result.getDecompiledFunction().getC());
                } else {
                    source.println("/* Decompilation failed: " + result.getErrorMessage().replace("*/", "* /") + " */");
                }
                if (count % 100 == 0) println("Exported " + count + " functions");
            }
            strings.println("address\tvalue\treference_from\tfunction");
            DataIterator data = currentProgram.getListing().getDefinedData(true);
            while (data.hasNext()) {
                Data item = data.next();
                if (!item.hasStringValue()) continue;
                String value = String.valueOf(item.getValue()).replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
                Reference[] refs = getReferencesTo(item.getAddress());
                if (refs.length == 0) strings.printf("%s\t%s\t\t%n", item.getAddress(), value);
                for (Reference ref : refs) {
                    Function function = getFunctionContaining(ref.getFromAddress());
                    strings.printf("%s\t%s\t%s\t%s%n", item.getAddress(), value, ref.getFromAddress(),
                        function == null ? "" : function.getName());
                }
            }
            summary.println("Program: " + currentProgram.getName());
            summary.println("SHA256: " + currentProgram.getExecutableSHA256());
            summary.println("Language: " + currentProgram.getLanguageID());
            summary.println("Compiler: " + currentProgram.getCompilerSpec().getCompilerSpecID());
            summary.println("Image base: " + currentProgram.getImageBase());
            summary.println("Functions: " + count);
            summary.println("Decompiled: " + success);
            for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
                summary.printf("Memory: %s %s-%s initialized=%s%n", block.getName(), block.getStart(), block.getEnd(), block.isInitialized());
            }
            println("Export complete: " + success + "/" + count + " functions");
        } finally {
            decompiler.dispose();
        }
    }
}
